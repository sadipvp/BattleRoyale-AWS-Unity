/**
 * ApiStack — API Gateway + Lambda Functions
 *
 * Creates the HTTP API that the Unity client calls for auth and matchmaking.
 * Depends on AuthStack (Cognito) and GameLiftStack (FlexMatch config name).
 *
 * API Routes:
 *   POST /auth/register        → authLambda       (public — no auth required)
 *   POST /auth/login           → authLambda       (public — no auth required)
 *   POST /match/find           → matchmakingLambda (requires Cognito JWT)
 *   GET  /match/status/{id}    → matchmakingLambda (requires Cognito JWT)
 *
 * Architecture note: Lambda functions are proxied via API Gateway (LAMBDA_PROXY
 * integration). The Lambda receives the full HTTP event and returns a response
 * with statusCode, headers, and body.
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

// Props from other stacks — TypeScript enforces these are passed at deploy time
export interface ApiStackProps extends cdk.StackProps {
  // From AuthStack
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  // From GameLiftStack
  matchmakingConfigName: string;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // Auth Lambda
    // -----------------------------------------------------------------------
    // Handles player registration and login by calling Cognito directly.
    // This Lambda acts as a proxy so Unity doesn't need to call Cognito SDK.
    // Explicit log groups with 1-week retention (avoids the deprecated logRetention prop)
    const authLogGroup = new logs.LogGroup(this, 'AuthLambdaLogGroup', {
      logGroupName: '/aws/lambda/TankBR-AuthHandler',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const authLambda = new lambdaNodejs.NodejsFunction(this, 'AuthFunction', {
      functionName: 'TankBR-AuthHandler',
      description: 'Handles player registration (SignUp) and login (InitiateAuth)',

      // Path to the Lambda handler file (relative to this CDK file)
      entry: path.join(__dirname, '../lambda/auth/index.ts'),
      handler: 'handler',

      // Node.js 20.x — latest LTS supported by Lambda
      runtime: lambda.Runtime.NODEJS_20_X,

      // Timeout: 10 seconds is plenty for a Cognito API call
      timeout: cdk.Duration.seconds(10),

      // Memory: 256 MB is more than enough; Lambda idles between requests
      memorySize: 256,

      // Environment variables the Lambda reads at runtime
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
        // Log level — set to DEBUG during development
        LOG_LEVEL: 'INFO',
      },

      // Explicit log group (logRetention prop is deprecated)
      logGroup: authLogGroup,

      // esbuild bundling config (NodejsFunction uses esbuild automatically)
      bundling: {
        // Don't bundle the AWS SDK — it's provided by the Lambda runtime
        externalModules: ['@aws-sdk/*'],
        minify: false,  // Keep readable for debugging
        sourceMap: true,
      },
    });

    // Grant the auth Lambda permission to call Cognito
    // SignUp: player registration
    // InitiateAuth: player login (USER_PASSWORD_AUTH flow)
    // ConfirmSignUp: if email verification is added later
    authLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CognitoAuthPermissions',
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:SignUp',
        'cognito-idp:InitiateAuth',
        'cognito-idp:ConfirmSignUp',  // Future: email verification
        'cognito-idp:ResendConfirmationCode',  // Future: resend verification email
      ],
      // Scope to only this specific User Pool
      resources: [props.userPool.userPoolArn],
    }));

    // -----------------------------------------------------------------------
    // Matchmaking Lambda
    // -----------------------------------------------------------------------
    // Handles starting a matchmaking search and polling for match status.
    // Only callable with a valid Cognito JWT (enforced by API Gateway authorizer).
    const matchmakingLogGroup = new logs.LogGroup(this, 'MatchmakingLambdaLogGroup', {
      logGroupName: '/aws/lambda/TankBR-MatchmakingHandler',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const matchmakingLambda = new lambdaNodejs.NodejsFunction(this, 'MatchmakingFunction', {
      functionName: 'TankBR-MatchmakingHandler',
      description: 'Starts FlexMatch matchmaking and returns ticket status',

      entry: path.join(__dirname, '../lambda/matchmaking/index.ts'),
      handler: 'handler',

      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15), // Slightly longer — GameLift API can be slow
      memorySize: 256,

      environment: {
        MATCHMAKING_CONFIG_NAME: props.matchmakingConfigName,
        LOG_LEVEL: 'INFO',
      },

      logGroup: matchmakingLogGroup,

      bundling: {
        externalModules: ['@aws-sdk/*'],
        minify: false,
        sourceMap: true,
      },
    });

    // Grant matchmaking Lambda permission to call GameLift FlexMatch
    matchmakingLambda.addToRolePolicy(new iam.PolicyStatement({
      sid: 'GameLiftMatchmakingPermissions',
      effect: iam.Effect.ALLOW,
      actions: [
        'gamelift:StartMatchmaking',       // POST /match/find
        'gamelift:DescribeMatchmaking',    // GET /match/status/{ticketId}
        'gamelift:StopMatchmaking',        // Future: cancel search
      ],
      // GameLift matchmaking ARNs are not always predictable — use *
      // In production, scope to the specific configuration ARN
      resources: ['*'],
    }));

    // -----------------------------------------------------------------------
    // API Gateway REST API
    // -----------------------------------------------------------------------
    // RestApi (v1) is used because it natively supports Cognito authorizers.
    // HTTP API (v2) would require Lambda authorizers instead.
    const api = new apigateway.RestApi(this, 'TankBRApi', {
      restApiName: 'tank-battle-royale-api',
      description: 'Tank Battle Royale — REST API for auth and matchmaking',

      // Enable CORS so Unity's UnityWebRequest doesn't get blocked.
      // Unity desktop builds don't have CORS restrictions, but good practice.
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },

      // Deploy to a stage named 'dev'
      deployOptions: {
        stageName: 'dev',
        // Enable CloudWatch logging for debugging
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true, // Log request/response bodies (disable in production)
        metricsEnabled: true,
      },
    });

    // -----------------------------------------------------------------------
    // Cognito Authorizer
    // -----------------------------------------------------------------------
    // Validates the Bearer JWT token in the Authorization header.
    // API Gateway calls Cognito to verify the token before invoking Lambda.
    // If the token is invalid/expired, API Gateway returns 401 automatically.
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [props.userPool],
        authorizerName: 'TankBR-CognitoAuthorizer',
        // Cache authorization result for 5 minutes (reduces Cognito calls)
        resultsCacheTtl: cdk.Duration.minutes(5),
        // The header Unity sends the token in
        identitySource: 'method.request.header.Authorization',
      }
    );

    // -----------------------------------------------------------------------
    // Lambda Integrations
    // -----------------------------------------------------------------------
    // LAMBDA_PROXY passes the full HTTP request to Lambda and returns Lambda's
    // response directly. The Lambda is responsible for the full response shape.
    const authIntegration = new apigateway.LambdaIntegration(authLambda, {
      proxy: true, // LAMBDA_PROXY integration
    });

    const matchmakingIntegration = new apigateway.LambdaIntegration(matchmakingLambda, {
      proxy: true,
    });

    // -----------------------------------------------------------------------
    // API Routes — /auth
    // -----------------------------------------------------------------------
    const authResource = api.root.addResource('auth');

    // POST /auth/register — player registration (public, no auth)
    const registerResource = authResource.addResource('register');
    registerResource.addMethod('POST', authIntegration, {
      // No authorizer — this is the registration endpoint, player has no token yet
      authorizationType: apigateway.AuthorizationType.NONE,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '500' },
      ],
    });

    // POST /auth/login — player login (public, no auth)
    const loginResource = authResource.addResource('login');
    loginResource.addMethod('POST', authIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '500' },
      ],
    });

    // -----------------------------------------------------------------------
    // API Routes — /match
    // -----------------------------------------------------------------------
    const matchResource = api.root.addResource('match');

    // POST /match/find — start matchmaking (requires valid JWT)
    const findResource = matchResource.addResource('find');
    findResource.addMethod('POST', matchmakingIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '500' },
      ],
    });

    // GET /match/status/{ticketId} — poll for match result (requires valid JWT)
    const statusResource = matchResource.addResource('status');
    const ticketResource = statusResource.addResource('{ticketId}');
    ticketResource.addMethod('GET', matchmakingIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '404' },
        { statusCode: '500' },
      ],
    });

    // -----------------------------------------------------------------------
    // CloudFormation Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway base URL — set this in Unity AuthClient.cs',
      exportName: 'TankBR-ApiUrl',
    });

    new cdk.CfnOutput(this, 'AuthLambdaArn', {
      value: authLambda.functionArn,
      description: 'Auth Lambda ARN',
    });

    new cdk.CfnOutput(this, 'MatchmakingLambdaArn', {
      value: matchmakingLambda.functionArn,
      description: 'Matchmaking Lambda ARN',
    });
  }
}
