#!/usr/bin/env node
/**
 * CDK App Entry Point — Tank Battle Royale
 *
 * Instantiates the three stacks in dependency order:
 *   1. AuthStack      — Cognito User Pool (no dependencies)
 *   2. GameLiftStack  — GameLift fleet + FlexMatch (no dependencies)
 *   3. ApiStack       — API Gateway + Lambda (depends on both above)
 *
 * Deploy with: npx cdk deploy --all
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { GameLiftStack } from '../lib/gamelift-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

// Common environment tags applied to all resources
const commonTags = {
  project: 'tank-battle-royale',
  environment: 'dev',
};

// Target AWS account/region — reads from environment variables or CDK defaults.
// Set AWS_ACCOUNT and AWS_REGION env vars, or run `aws configure` before deploying.
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// --- Stack 1: Cognito Authentication ---
const authStack = new AuthStack(app, 'TankBR-AuthStack', {
  env,
  description: 'Tank Battle Royale — Cognito User Pool for player authentication',
  tags: commonTags,
});

// --- Stack 2: GameLift Fleet + FlexMatch ---
const gameLiftStack = new GameLiftStack(app, 'TankBR-GameLiftStack', {
  env,
  description: 'Tank Battle Royale — GameLift fleet and FlexMatch matchmaking',
  tags: commonTags,
});

// --- Stack 3: API Gateway + Lambda ---
// Receives outputs from AuthStack and GameLiftStack as props
const apiStack = new ApiStack(app, 'TankBR-ApiStack', {
  env,
  description: 'Tank Battle Royale — API Gateway and Lambda functions',
  tags: commonTags,
  // Cross-stack references: CDK automatically creates SSM or CFn exports
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  matchmakingConfigName: gameLiftStack.matchmakingConfigName,
});

// Ensure ApiStack is deployed after its dependencies
apiStack.addDependency(authStack);
apiStack.addDependency(gameLiftStack);
