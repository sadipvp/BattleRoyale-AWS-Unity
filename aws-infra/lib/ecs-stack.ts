import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  authDbSecret: secretsmanager.ISecret;
  matchmakingTicketsTableName: string;
  matchmakingSessionsTableName: string;
  authRepo: ecr.Repository;
  matchmakingRepo: ecr.Repository;
}

/**
 * ECS stack: cluster, ALB, and Fargate services for Auth and Matchmaking.
 *
 * ALB routing (path-based):
 *   /api/v1/register     → auth target group  (priority 10)
 *   /api/v1/login        → auth target group  (priority 11)
 *   /api/v1/me           → auth target group  (priority 12)
 *   /health              → auth target group  (priority 13, health check)
 *   /api/v1/join         → matchmaking tg     (priority 20)
 *   /api/v1/match-status/* → matchmaking tg   (priority 21)
 *   default              → 404
 *
 * Secrets:
 *   JWT_SECRET is read from Secrets Manager key "tank-battle/jwt-secret".
 *   This secret must be created manually before deploying this stack:
 *     aws secretsmanager create-secret \
 *       --name tank-battle/jwt-secret \
 *       --secret-string '{"jwt_secret":"your-value-here"}'
 */
export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: "tank-battle-cluster",
      containerInsights: true,
    });

    // ── ALB ────────────────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
      loadBalancerName: "tank-battle-alb",
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      // Default: return 404 for unmatched paths
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not found",
      }),
    });

    // ── Shared JWT secret reference ────────────────────────────────────────────
    // This secret must be created manually in Secrets Manager before deploying.
    // Format: {"jwt_secret": "your-random-string"}
    const jwtSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "JwtSecret",
      "tank-battle/jwt-secret"
    );

    // ── Auth Service ───────────────────────────────────────────────────────────
    const authLogGroup = new logs.LogGroup(this, "AuthLogGroup", {
      logGroupName: "/ecs/tank-battle/auth",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const authTaskDef = new ecs.FargateTaskDefinition(this, "AuthTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    authTaskDef.addContainer("auth", {
      image: ecs.ContainerImage.fromEcrRepository(props.authRepo, "latest"),
      // Static env vars (non-sensitive)
      environment: {
        JWT_ALGORITHM: "HS256",
        JWT_EXPIRY_HOURS: "24",
        DB_NAME: "authdb",
        DB_PORT: "5432",
      },
      // Secrets injected from Secrets Manager at container startup
      secrets: {
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, "jwt_secret"),
        DB_HOST: ecs.Secret.fromSecretsManager(props.authDbSecret, "host"),
        DB_USER: ecs.Secret.fromSecretsManager(props.authDbSecret, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.authDbSecret, "password"),
      },
      portMappings: [{ containerPort: 8000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "auth",
        logGroup: authLogGroup,
      }),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8000/api/v1/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // grantRead must come after addContainer — CDK creates the execution role lazily
    // once it knows the task definition has secrets to fetch.
    jwtSecret.grantRead(authTaskDef.executionRole!);
    props.authDbSecret.grantRead(authTaskDef.executionRole!);

    const authService = new ecs.FargateService(this, "AuthService", {
      cluster,
      taskDefinition: authTaskDef,
      serviceName: "auth-service",
      desiredCount: 1,
      securityGroups: [props.ecsSecurityGroup],
      // Public subnet + assignPublicIp replaces NAT gateway (cost optimization).
      // The task gets a public IP so it can reach ECR and AWS APIs directly.
      // Security groups still restrict inbound to the ALB only.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
    });

    const authTargetGroup = new elbv2.ApplicationTargetGroup(this, "AuthTargetGroup", {
      vpc: props.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/api/v1/health",
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: "200",
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    authService.attachToApplicationTargetGroup(authTargetGroup);

    // Auth routing rules
    listener.addAction("AuthRegister", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/register"])],
      action: elbv2.ListenerAction.forward([authTargetGroup]),
    });
    listener.addAction("AuthLogin", {
      priority: 11,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/login"])],
      action: elbv2.ListenerAction.forward([authTargetGroup]),
    });
    listener.addAction("AuthMe", {
      priority: 12,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/me"])],
      action: elbv2.ListenerAction.forward([authTargetGroup]),
    });
    listener.addAction("AuthHealth", {
      priority: 13,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/health"])],
      action: elbv2.ListenerAction.forward([authTargetGroup]),
    });

    // Auth auto-scaling
    const authScaling = authService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });
    authScaling.scaleOnCpuUtilization("AuthCpuScaling", {
      targetUtilizationPercent: 70,
    });

    // ── Matchmaking Service ────────────────────────────────────────────────────
    const mmLogGroup = new logs.LogGroup(this, "MatchmakingLogGroup", {
      logGroupName: "/ecs/tank-battle/matchmaking",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mmTaskDef = new ecs.FargateTaskDefinition(this, "MatchmakingTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Grant matchmaking task role access to DynamoDB and GameLift.
    // FargateTaskDefinition.taskRole is typed as IRole; cast to Role to call addToPolicy.
    const mmRole = mmTaskDef.taskRole as iam.Role;

    mmRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DynamoDBAccess",
        actions: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.matchmakingTicketsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.matchmakingSessionsTableName}`,
        ],
      })
    );

    mmRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "GameLiftMatchmaking",
        actions: [
          "gamelift:StartMatchmaking",
          "gamelift:DescribeMatchmaking",
          "gamelift:StopMatchmaking",
        ],
        resources: ["*"], // GameLift FlexMatch resources don't support resource-level perms
      })
    );

    mmTaskDef.addContainer("matchmaking", {
      image: ecs.ContainerImage.fromEcrRepository(props.matchmakingRepo, "latest"),
      environment: {
        AWS_REGION: this.region,
        FLEXMATCH_CONFIG_NAME: "tank-battle-4v4",
        DYNAMODB_TICKETS_TABLE: props.matchmakingTicketsTableName,
        DYNAMODB_SESSIONS_TABLE: props.matchmakingSessionsTableName,
        MOCK_GAMELIFT: "false",  // use real GameLift in production
      },
      secrets: {
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, "jwt_secret"),
      },
      portMappings: [{ containerPort: 8000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "matchmaking",
        logGroup: mmLogGroup,
      }),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8000/api/v1/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    jwtSecret.grantRead(mmTaskDef.executionRole!);

    const mmService = new ecs.FargateService(this, "MatchmakingService", {
      cluster,
      taskDefinition: mmTaskDef,
      serviceName: "matchmaking-service",
      desiredCount: 1,
      securityGroups: [props.ecsSecurityGroup],
      // Same public subnet strategy as auth — no NAT gateway.
      // Matchmaking also needs outbound internet access to call GameLift and DynamoDB APIs.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
    });

    const mmTargetGroup = new elbv2.ApplicationTargetGroup(this, "MatchmakingTargetGroup", {
      vpc: props.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/api/v1/health",
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: "200",
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    mmService.attachToApplicationTargetGroup(mmTargetGroup);

    // Matchmaking routing rules
    listener.addAction("MatchmakingJoin", {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/join"])],
      action: elbv2.ListenerAction.forward([mmTargetGroup]),
    });
    listener.addAction("MatchmakingStatus", {
      priority: 21,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/match-status/*"])],
      action: elbv2.ListenerAction.forward([mmTargetGroup]),
    });

    // Matchmaking auto-scaling
    const mmScaling = mmService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });
    mmScaling.scaleOnCpuUtilization("MatchmakingCpuScaling", {
      targetUtilizationPercent: 70,
    });

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS name — use this as the API base URL in the Unity client",
    });
  }
}
