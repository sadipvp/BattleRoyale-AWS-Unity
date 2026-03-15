#!/usr/bin/env node
/**
 * CDK app entry point.
 *
 * Stack deployment order (CDK infers dependencies from cross-stack references):
 *   NetworkStack → DatabaseStack → EcrStack → EcsStack → GameLiftStack
 *
 * First-time deploy order:
 *   1. cdk deploy EcrStack              (ECR repos must exist before CI pushes images)
 *   2. Create secrets manually in AWS Secrets Manager (see README / setup guide)
 *   3. cdk deploy NetworkStack DatabaseStack EcsStack GameLiftStack
 */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { DatabaseStack } from "../lib/database-stack";
import { EcrStack } from "../lib/ecr-stack";
import { EcsStack } from "../lib/ecs-stack";
import { GameLiftStack } from "../lib/gamelift-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const tags = {
  project: "tank-battle-royale",
  environment: "production",
};

const networkStack = new NetworkStack(app, "TankBattle-NetworkStack", { env, tags });

const databaseStack = new DatabaseStack(app, "TankBattle-DatabaseStack", {
  env,
  tags,
  vpc: networkStack.vpc,
  dbSecurityGroup: networkStack.dbSecurityGroup,
});

const ecrStack = new EcrStack(app, "TankBattle-EcrStack", { env, tags });

const ecsStack = new EcsStack(app, "TankBattle-EcsStack", {
  env,
  tags,
  vpc: networkStack.vpc,
  albSecurityGroup: networkStack.albSecurityGroup,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  authDbSecret: databaseStack.authDbSecret,
  matchmakingTicketsTableName: databaseStack.matchmakingTicketsTableName,
  matchmakingSessionsTableName: databaseStack.matchmakingSessionsTableName,
  authRepo: ecrStack.authRepo,
  matchmakingRepo: ecrStack.matchmakingRepo,
});

const gameliftStack = new GameLiftStack(app, "TankBattle-GameLiftStack", { env, tags });

app.synth();
