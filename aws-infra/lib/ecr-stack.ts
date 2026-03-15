import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

/**
 * ECR stack — container image repositories.
 *
 * Why a separate stack from ECS:
 *   ECR repos must exist BEFORE the first docker push (which happens in CI/CD).
 *   ECS services are deployed later (after images exist in ECR).
 *   Deploying EcrStack first: `cdk deploy TankBattle-EcrStack`
 *   Then CI can push images, then EcsStack can reference them.
 */
export class EcrStack extends cdk.Stack {
  readonly authRepo: ecr.Repository;
  readonly matchmakingRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.authRepo = new ecr.Repository(this, "AuthServiceRepo", {
      repositoryName: "tank-battle/auth-service",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          maxImageCount: 5,
          description: "Keep last 5 images",
        },
      ],
    });

    this.matchmakingRepo = new ecr.Repository(this, "MatchmakingServiceRepo", {
      repositoryName: "tank-battle/matchmaking-service",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          maxImageCount: 5,
          description: "Keep last 5 images",
        },
      ],
    });

    new cdk.CfnOutput(this, "AuthRepoUri", {
      value: this.authRepo.repositoryUri,
      description: "Auth service ECR repository URI",
    });
    new cdk.CfnOutput(this, "MatchmakingRepoUri", {
      value: this.matchmakingRepo.repositoryUri,
      description: "Matchmaking service ECR repository URI",
    });
  }
}
