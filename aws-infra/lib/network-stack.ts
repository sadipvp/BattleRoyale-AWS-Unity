import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

/**
 * Network stack: VPC, subnets, security groups.
 *
 * Layout:
 *   - VPC across 2 AZs (us-east-1a, us-east-1b)
 *   - Public subnets: ALB and NAT gateways
 *   - Private subnets: ECS Fargate tasks and RDS instances
 *   - 1 NAT gateway (cost: ~$32/month — use 2 for production HA)
 *
 * Security group rules enforce least-privilege:
 *   - ALB accepts inbound 80/443 from anywhere
 *   - ECS tasks only accept inbound from the ALB (port 8000)
 *   - RDS only accepts inbound from ECS tasks (port 5432)
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  readonly albSecurityGroup: ec2.SecurityGroup;
  readonly ecsSecurityGroup: ec2.SecurityGroup;
  readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // VPC with public + private subnets across 2 AZs
    // natGateways: 1 reduces cost for a course project (no AZ redundancy for NAT)
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ALB security group — internet-facing
    this.albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: this.vpc,
      description: "Allow HTTP/HTTPS inbound to ALB",
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere"
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS from anywhere"
    );

    // ECS security group — only accepts traffic from the ALB
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      description: "Allow inbound from ALB only",
      allowAllOutbound: true,
    });
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(8000),
      "Allow from ALB on container port 8000"
    );

    // DB security group — only accepts traffic from ECS tasks
    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc: this.vpc,
      description: "Allow PostgreSQL from ECS tasks only",
      allowAllOutbound: false,
    });
    this.dbSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL from ECS tasks"
    );
  }
}
