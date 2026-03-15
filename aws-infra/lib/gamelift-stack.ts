import * as cdk from "aws-cdk-lib";
import * as gamelift from "aws-cdk-lib/aws-gamelift";
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";

/**
 * GameLift stack: FlexMatch rule set, matchmaking configuration, and game session queue.
 *
 * Status: PARTIAL — fleet is not yet configured.
 * The fleet requires a Unity headless server binary uploaded as a GameLift Build.
 *
 * What's included:
 *   - FlexMatch MatchmakingRuleSet (2-4 players per match)
 *   - GameSessionQueue (empty — no fleet destinations yet)
 *   - FlexMatch MatchmakingConfiguration (references rule set + queue)
 *
 * TODO (when Unity server is ready):
 *   1. Upload Unity headless build: aws gamelift upload-build ...
 *   2. Uncomment the CfnFleet block below and fill in buildId
 *   3. Add the fleet as a destination in the CfnGameSessionQueue
 *   4. Set MOCK_GAMELIFT=false in the ECS matchmaking task definition
 */
export class GameLiftStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const ruleSetBody = fs.readFileSync(
      path.join(__dirname, "../flexmatch/matchmaking-ruleset.json"),
      "utf-8"
    );

    // FlexMatch rule set: 2-4 players per match (minPlayers: 2, maxPlayers: 4)
    const ruleSet = new gamelift.CfnMatchmakingRuleSet(this, "RuleSet", {
      name: "tank-battle-4v4-rules",
      ruleSetBody,
    });

    // Game session queue — required by CfnMatchmakingConfiguration even before a fleet exists.
    // No destinations for now; add the fleet once it's deployed:
    //   destinations: [{ destinationArn: `arn:aws:gamelift:${this.region}:${this.account}:fleet/${fleet.ref}` }]
    const queue = new gamelift.CfnGameSessionQueue(this, "Queue", {
      name: "tank-battle-queue",
      timeoutInSeconds: 30,
    });

    // FlexMatch matchmaking configuration.
    // The matchmaking service uses MOCK_GAMELIFT=true so this isn't called at runtime yet.
    // Once the fleet is deployed: set MOCK_GAMELIFT=false in the ECS matchmaking task definition.
    const matchmakingConfig = new gamelift.CfnMatchmakingConfiguration(
      this,
      "MatchmakingConfig",
      {
        name: "tank-battle-4v4",
        acceptanceRequired: false,
        requestTimeoutSeconds: 30,
        ruleSetName: ruleSet.name,
        gameSessionQueueArns: [
          `arn:aws:gamelift:${this.region}:${this.account}:gamesessionqueue/${queue.name}`,
        ],
      }
    );

    matchmakingConfig.addDependency(ruleSet);
    matchmakingConfig.addDependency(queue);

    // TODO: GameLift Fleet (requires Unity headless server build)
    // const fleet = new gamelift.CfnFleet(this, "Fleet", {
    //   name: "tank-battle-fleet",
    //   buildId: "...",   // upload Unity headless build first, get the Build ID
    //   ec2InboundPermissions: [{
    //     fromPort: 7777,
    //     toPort: 7780,
    //     ipRange: "0.0.0.0/0",
    //     protocol: "UDP",
    //   }],
    //   ec2InstanceType: "c5.large",
    //   fleetType: "ON_DEMAND",
    //   runtimeConfiguration: {
    //     serverProcesses: [{
    //       launchPath: "/local/game/TankBattleServer",
    //       parameters: "-logFile /local/game/logs/server.log",
    //       concurrentExecutions: 1,
    //     }],
    //   },
    // });

    new cdk.CfnOutput(this, "MatchmakingConfigName", {
      value: matchmakingConfig.name,
      description: "FlexMatch configuration name — set as FLEXMATCH_CONFIG_NAME env var",
    });
  }
}
