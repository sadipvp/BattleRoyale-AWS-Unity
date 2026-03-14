/**
 * AuthStack — Cognito User Pool
 *
 * Creates the authentication infrastructure:
 *   - UserPool: stores player accounts, handles registration + password policy
 *   - UserPoolClient: allows Unity (no browser) to call Cognito directly via
 *     USER_PASSWORD_AUTH. IMPORTANT: no client secret — Unity can't sign requests.
 *
 * Outputs used by ApiStack:
 *   - userPool (L2 construct reference, not just the ID)
 *   - userPoolClient (same)
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  // Expose these so ApiStack can reference them (cross-stack)
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // Cognito User Pool
    // -----------------------------------------------------------------------
    // selfSignUpEnabled: players can register themselves from the Unity client.
    // No email verification for MVP — keeps onboarding frictionless.
    // No MFA for MVP — adds complexity Unity clients can't handle easily.
    this.userPool = new cognito.UserPool(this, 'PlayerPool', {
      userPoolName: 'tank-battle-royale-players',

      // Allow players to sign up themselves (no admin approval needed)
      selfSignUpEnabled: true,

      // Use email as the sign-in identifier; also allow username
      signInAliases: {
        email: true,
        username: true,
      },

      // Auto-verify email attribute so tokens include email claim
      // (In production you'd send a verification email; for MVP we skip that.)
      autoVerify: {
        email: true,
      },

      // Password policy — reasonable minimum for a course project
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false, // Relaxed for usability
        requireDigits: true,
        requireSymbols: false,
      },

      // Account recovery via email link
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Removal policy: DESTROY for dev so `cdk destroy` cleans everything up.
      // Change to RETAIN in production to avoid losing player accounts!
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -----------------------------------------------------------------------
    // User Pool Client
    // -----------------------------------------------------------------------
    // This is what the Unity client (via our Lambda proxy) uses to authenticate.
    // Key point: generateSecret: false — Unity can't securely store a client
    // secret, so we use the public client flow.
    this.userPoolClient = this.userPool.addClient('UnityAppClient', {
      userPoolClientName: 'unity-app-client',

      // No client secret — required for mobile/desktop apps that can't keep secrets
      generateSecret: false,

      // USER_PASSWORD_AUTH: Lambda sends username + password to Cognito directly.
      // This is the simplest auth flow for server-side proxies.
      authFlows: {
        userPassword: true,   // USER_PASSWORD_AUTH flow
        userSrp: false,       // SRP (Secure Remote Password) — not needed since Lambda proxies
        adminUserPassword: false,
        custom: false,
      },

      // OAuth is not used — Unity connects via Lambda, not a browser
      disableOAuth: true,

      // Token validity mirrors the UserPool settings above
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(7),

      // Prevent user existence errors from leaking (security best practice)
      preventUserExistenceErrors: true,
    });

    // -----------------------------------------------------------------------
    // CloudFormation Outputs
    // -----------------------------------------------------------------------
    // These values are needed to configure the Lambda environment variables
    // and for manual testing with tools like Postman or AWS CLI.
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID — set as USER_POOL_ID in Lambda env',
      exportName: 'TankBR-UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID — set as USER_POOL_CLIENT_ID in Lambda env',
      exportName: 'TankBR-UserPoolClientId',
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN — used for IAM policies',
      exportName: 'TankBR-UserPoolArn',
    });
  }
}
