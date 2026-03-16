import * as cdk from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"

/**
 * Network stack: VPC, subnets, security groups.
 *
 * Layout:
 *   - VPC across 2 AZs (us-east-1a, us-east-1b)
 *   - Public subnets:          ALB + Fargate tasks (assignPublicIp: true)
 *   - Private isolated subnets: RDS instances (no internet access needed)
 *   - NO NAT Gateway (cost optimization: saves ~$32/month for this course project)
 *
 * Why Fargate in public subnets?
 *   Without a NAT gateway, tasks in private subnets have no route to the internet and
 *   cannot pull images from ECR or call AWS APIs (GameLift, DynamoDB). Moving Fargate to
 *   public subnets with assignPublicIp: true gives them direct internet access at no extra
 *   cost. Security groups still ensure only the ALB can reach containers on port 8000.
 *   In production, you would keep Fargate in private subnets behind a NAT gateway (or VPC
 *   endpoints) to avoid exposing container ENIs to the public internet.
 *
 * Security group rules enforce least-privilege:
 *   - ALB accepts inbound 80/443 from anywhere
 *   - ECS tasks only accept inbound from the ALB (port 8000)
 *   - RDS only accepts inbound from ECS tasks (port 5432)
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc
  readonly albSecurityGroup: ec2.SecurityGroup
  readonly ecsSecurityGroup: ec2.SecurityGroup
  readonly dbSecurityGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    // VPC with public subnets (Fargate + ALB) and isolated private subnets (RDS) across 2 AZs.
    // natGateways: 0 — no NAT gateway saves ~$32/month. Fargate uses assignPublicIp: true instead.
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          // RDS instances live here — no internet access required.
          // PRIVATE_ISOLATED = private subnet with no NAT route (truly air-gapped from internet).
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    })

    // ALB security group — internet-facing
    this.albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: this.vpc,
      description: "Allow HTTP/HTTPS inbound to ALB",
      allowAllOutbound: true,
    })
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere"
    )
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS from anywhere"
    )

    // ECS security group — only accepts traffic from the ALB
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      description: "Allow inbound from ALB only",
      allowAllOutbound: true,
    })
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(8000),
      "Allow from ALB on container port 8000"
    )

    // DB security group — only accepts traffic from ECS tasks
    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc: this.vpc,
      description: "Allow PostgreSQL from ECS tasks only",
      allowAllOutbound: false,
    })
    this.dbSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL from ECS tasks"
    )
  }
}
