/**
 * GameLiftStack — GameLift Fleet + FlexMatch Matchmaking
 *
 * All GameLift resources use L1 (Cfn*) constructs because CDK v2 does not
 * provide L2 constructs for GameLift Fleet, MatchmakingConfiguration, etc.
 *
 * Resources created:
 *   - CfnBuild:                    Placeholder server build (upload real binary post-deploy)
 *   - CfnFleet:                    EC2 fleet (c5.large) running the Unity headless server
 *   - CfnAlias:                    SIMPLE routing alias pointing to the fleet
 *   - CfnGameSessionQueue:         Queue that FlexMatch uses to place sessions on the fleet
 *   - CfnMatchmakingRuleSet:       FlexMatch rules (4 players, latency ≤ 200ms)
 *   - CfnMatchmakingConfiguration: Ties the rule set + queue together
 *
 * Manual step after deploy:
 *   1. Build the Unity headless server (SERVER define, Linux/x86_64)
 *   2. Zip the build output and upload to the S3 path referenced in CfnBuild
 *   3. The fleet will stay in ACTIVATING until a valid build is associated
 */

import * as cdk from 'aws-cdk-lib';
import * as gamelift from 'aws-cdk-lib/aws-gamelift';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class GameLiftStack extends cdk.Stack {
  // Expose for ApiStack (matchmaking Lambda needs the config name)
  public readonly matchmakingConfigName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // S3 Bucket for GameLift server builds
    // -----------------------------------------------------------------------
    // GameLift needs to pull the Unity headless server binary from S3.
    // After deploying this stack, upload your build zip to this bucket.
    const buildBucket = new s3.Bucket(this, 'GameLiftBuildBucket', {
      bucketName: `tank-br-gamelift-builds-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // Clean up on `cdk destroy`
    });

    // IAM role that allows GameLift to read the build from S3
    const gameLiftBuildRole = new iam.Role(this, 'GameLiftBuildRole', {
      roleName: 'TankBR-GameLiftBuildRole',
      assumedBy: new iam.ServicePrincipal('gamelift.amazonaws.com'),
      description: 'Allows GameLift to download server builds from S3',
    });
    buildBucket.grantRead(gameLiftBuildRole);

    // -----------------------------------------------------------------------
    // GameLift Build (Placeholder)
    // -----------------------------------------------------------------------
    // This creates the Build record in GameLift. The actual binary must be
    // uploaded to S3 separately (see manual steps in the stack docstring).
    //
    // StorageLocation points to a placeholder path — replace with your actual
    // zip after running `cdk deploy`.
    const serverBuild = new gamelift.CfnBuild(this, 'ServerBuild', {
      name: 'TankBattleRoyale-Server',
      version: '0.1.0',
      operatingSystem: 'AMAZON_LINUX_2023',
      storageLocation: {
        bucket: buildBucket.bucketName,
        key: 'server-builds/TankBattleRoyale-Server-v0.1.0.zip',
        roleArn: gameLiftBuildRole.roleArn,
      },
    });

    // -----------------------------------------------------------------------
    // GameLift Fleet
    // -----------------------------------------------------------------------
    // Runs the dedicated Unity headless server on EC2 instances.
    // c5.large: 2 vCPU, 4 GB RAM — sufficient for 4-player matches.
    // Port 7777 UDP: default Unity Transport (NGO) port.
    const fleet = new gamelift.CfnFleet(this, 'GameServerFleet', {
      name: 'TankBattleRoyale-Fleet',
      description: 'EC2 fleet for Tank Battle Royale dedicated servers',

      // Reference the build we just created
      buildId: serverBuild.ref,

      // c5.large is cost-effective for small 4-player matches
      ec2InstanceType: 'c5.large',

      // Instance count — these props are deprecated in CDK but still valid in CloudFormation.
      // For a course project this is fine; in production use GameLift auto-scaling policies.
      /* eslint-disable @typescript-eslint/no-deprecated */
      desiredEc2Instances: 1,
      minSize: 1,
      maxSize: 10,
      /* eslint-enable @typescript-eslint/no-deprecated */

      // The launch path must match where the Unity build places the executable
      // inside the GameLift managed server directory.
      runtimeConfiguration: {
        serverProcesses: [
          {
            launchPath: '/local/game/TankBattleRoyale.x86_64',
            // Pass port as argument so Unity server reads it via args
            parameters: '-port 7777 -logFile /local/game/logs/server.log',
            // How many game sessions can run simultaneously per instance.
            // One session = one 4-player match. Adjust based on server load.
            concurrentExecutions: 5,
          },
        ],
        // How long GameLift waits for a game session to be ready (seconds)
        gameSessionActivationTimeoutSeconds: 60,
        // Max concurrent active game sessions per instance
        maxConcurrentGameSessionActivations: 2,
      },

      // Inbound traffic rules — allow Unity Transport UDP on port 7777
      ec2InboundPermissions: [
        {
          fromPort: 7777,
          toPort: 7777,
          ipRange: '0.0.0.0/0', // Restrict in production
          protocol: 'UDP',
        },
      ],

      // NEW_GAME_SESSION_PROTECTION: prevents GameLift from terminating an
      // instance that has an active game session during scale-down.
      newGameSessionProtectionPolicy: 'FullProtection',
    });

    // -----------------------------------------------------------------------
    // Fleet Alias
    // -----------------------------------------------------------------------
    // An alias provides a stable reference to the fleet. FlexMatch uses the
    // alias ARN so you can swap fleets (e.g. after uploading a new build)
    // without updating other configurations.
    const fleetAlias = new gamelift.CfnAlias(this, 'FleetAlias', {
      name: 'TankBattleRoyale-FleetAlias',
      description: 'Alias for the Tank Battle Royale game server fleet',
      routingStrategy: {
        type: 'SIMPLE', // Route directly to the fleet (vs TERMINAL which shows a message)
        fleetId: fleet.ref,
      },
    });

    // -----------------------------------------------------------------------
    // Game Session Queue
    // -----------------------------------------------------------------------
    // FlexMatch doesn't place game sessions directly on fleets — it uses a
    // queue. The queue determines which fleet(s) to try and in what order.
    const sessionQueue = new gamelift.CfnGameSessionQueue(this, 'GameSessionQueue', {
      name: 'TankBattleRoyale-Queue',

      // How long FlexMatch waits for placement before giving up (seconds)
      timeoutInSeconds: 120,

      // Ordered list of destinations FlexMatch tries
      destinations: [
        {
          // Reference the alias (not fleet directly) for flexibility
          destinationArn: `arn:aws:gamelift:${this.region}:${this.account}:alias/${fleetAlias.ref}`,
        },
      ],

      // Player latency policy: first try ≤200ms, then relax to ≤500ms after 30s
      playerLatencyPolicies: [
        {
          maximumIndividualPlayerLatencyMilliseconds: 200,
          // No policyDurationSeconds = this policy applies first
        },
        {
          maximumIndividualPlayerLatencyMilliseconds: 500,
          // After 30 seconds of searching, relax the latency requirement
          policyDurationSeconds: 30,
        },
      ],
    });

    // -----------------------------------------------------------------------
    // FlexMatch Rule Set
    // -----------------------------------------------------------------------
    // Defines the matchmaking rules: team composition and latency constraints.
    // Rule set version 2018-05-21 is the current stable version.
    //
    // This could also reference an external JSON file, but embedding here
    // keeps everything in one place for the course project.
    const ruleSetBody = {
      name: 'TankBattleRoyale-RuleSet',
      ruleLanguageVersion: '2018-05-21',

      // Player attributes that FlexMatch can use in rules
      playerAttributes: [
        {
          name: 'latencyInMs',
          type: 'latencyMilliseconds', // Special type for latency maps
        },
      ],

      // Single team of 4 players (last tank standing, free-for-all)
      teams: [
        {
          name: 'players',
          minPlayers: 4,
          maxPlayers: 4,
        },
      ],

      // Matchmaking rules
      rules: [
        {
          name: 'FastConnection',
          description: 'Require players to have low latency to the destination',
          type: 'latency',
          maxLatency: 200, // milliseconds
        },
      ],

      // Expansions: relax rules over time so players don't wait forever
      expansions: [
        {
          // After 30 seconds, relax the latency requirement
          waitTimeSeconds: 30,
          claims: [
            {
              rule: 'FastConnection',
              expansion: [
                { maxLatency: 500 }, // Relax from 200ms to 500ms
              ],
            },
          ],
        },
        {
          // After 60 seconds, allow any latency (ensure match is always found)
          waitTimeSeconds: 60,
          claims: [
            {
              rule: 'FastConnection',
              expansion: [
                { maxLatency: 1000 },
              ],
            },
          ],
        },
      ],
    };

    const matchmakingRuleSet = new gamelift.CfnMatchmakingRuleSet(this, 'MatchmakingRuleSet', {
      name: 'TankBattleRoyale-RuleSet',
      ruleSetBody: JSON.stringify(ruleSetBody),
    });

    // -----------------------------------------------------------------------
    // FlexMatch Matchmaking Configuration
    // -----------------------------------------------------------------------
    // Ties the rule set + session queue together into a named configuration
    // that clients call when looking for a match.
    this.matchmakingConfigName = 'TankBattleRoyale-MatchConfig';

    const matchmakingConfig = new gamelift.CfnMatchmakingConfiguration(this, 'MatchmakingConfig', {
      name: this.matchmakingConfigName,
      description: 'FlexMatch config for 4-player Tank Battle Royale matches',

      // Required: reference the rule set
      ruleSetName: matchmakingRuleSet.ref,

      // Required: reference the session queue for game placement
      gameSessionQueueArns: [sessionQueue.attrArn],

      // How long to search before timing out (seconds)
      requestTimeoutSeconds: 120,

      // Accept mode: players don't need to explicitly accept — auto-accept.
      // For MVP this avoids implementing an acceptance UI in Unity.
      acceptanceRequired: false,

      // backfillMode: MANUAL means the server requests backfill explicitly.
      // AUTOMATIC would fill vacant spots mid-game (not desired for BR).
      backfillMode: 'MANUAL',

      // Flex match notification target — optional for MVP.
      // Without this, clients poll DescribeMatchmaking to check status.
      // (Add an SNS ARN here in production for push notifications.)
    });

    // Ensure the configuration is created after the rule set
    matchmakingConfig.addDependency(matchmakingRuleSet);
    matchmakingConfig.addDependency(sessionQueue);

    // -----------------------------------------------------------------------
    // CloudFormation Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'FleetId', {
      value: fleet.ref,
      description: 'GameLift Fleet ID',
      exportName: 'TankBR-FleetId',
    });

    new cdk.CfnOutput(this, 'FleetAliasId', {
      value: fleetAlias.ref,
      description: 'GameLift Fleet Alias ID',
      exportName: 'TankBR-FleetAliasId',
    });

    new cdk.CfnOutput(this, 'MatchmakingConfigName', {
      value: this.matchmakingConfigName,
      description: 'FlexMatch matchmaking configuration name — set as MATCHMAKING_CONFIG_NAME in Lambda',
      exportName: 'TankBR-MatchmakingConfigName',
    });

    new cdk.CfnOutput(this, 'BuildBucketName', {
      value: buildBucket.bucketName,
      description: 'S3 bucket for uploading GameLift server builds',
      exportName: 'TankBR-BuildBucketName',
    });

    new cdk.CfnOutput(this, 'GameSessionQueueArn', {
      value: sessionQueue.attrArn,
      description: 'Game Session Queue ARN',
      exportName: 'TankBR-GameSessionQueueArn',
    });
  }
}
