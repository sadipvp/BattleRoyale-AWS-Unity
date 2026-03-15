import * as cdk from "aws-cdk-lib";
import * as gamelift from "aws-cdk-lib/aws-gamelift";
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";

/**
 * GameLift stack: FlexMatch rule set and matchmaking configuration.
 *
 * Status: PARTIAL — fleet and queue are not yet configured.
 * The fleet requires a Unity headless server binary uploaded as a GameLift Build,
 * which cannot be automated until the Unity server is implemented.
 *
 * What's included:
 *   - FlexMatch MatchmakingRuleSet (4v4 with expansion to 2-player)
 *   - FlexMatch MatchmakingConfiguration (references the rule set)
 *
 * TODO (when Unity server is ready):
 *   1. Upload Unity headless build to GameLift Build
 *   2. Uncomment GameLift Fleet definition below
 *   3. Create GameSession Queue
 *   4. Add gameSessionQueueArns to MatchmakingConfiguration
 *   5. Set MOCK_GAMELIFT=false in ECS matchmaking task definition
 */
export class GameLiftStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const ruleSetBody = fs.readFileSync(
      path.join(__dirname, "../flexmatch/matchmaking-ruleset.json"),
      "utf-8"
    );

    // FlexMatch rule set: 4 players per match, expands to 2 after 15s wait
    const ruleSet = new gamelift.CfnMatchmakingRuleSet(this, "RuleSet", {
      name: "tank-battle-4v4-rules",
      ruleSetBody,
    });

    // FlexMatch matchmaking configuration
    // gameSessionQueueArns is intentionally omitted until the fleet is deployed.
    // The matchmaking service uses MOCK_GAMELIFT=true until the queue is set up.
    const matchmakingConfig = new gamelift.CfnMatchmakingConfiguration(
      this,
      "MatchmakingConfig",
      {
        name: "tank-battle-4v4",
        acceptanceRequired: false,
        requestTimeoutSeconds: 30,
        ruleSetName: ruleSet.name,
        // TODO: uncomment after fleet + queue are deployed
        // gameSessionQueueArns: [`arn:aws:gamelift:${this.region}:${this.account}:gamesessionqueue/tank-battle-queue`],
      }
    );

    matchmakingConfig.addDependency(ruleSet);

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
