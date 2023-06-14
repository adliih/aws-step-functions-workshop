import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as batch from "aws-cdk-lib/aws-batch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

export class AwsStepFunctionsWorkshopStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'AwsStepFunctionsWorkshopQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // this.createHelloWorldStack();

    // this.createTaskStateRequestResponseStack();

    // this.createTaskStateRunAJobSyncStack(); -- SKIPPED

    this.createCallbackWithTaskTokenStack();
  }

  createHelloWorldStack() {
    new stepfunctions.StateMachine(this, "TimerStateMachine", {
      definition: new stepfunctions.Wait(this, "Wait for Timer", {
        time: stepfunctions.WaitTime.secondsPath("$.timer_seconds"),
      }).next(new stepfunctions.Succeed(this, "Success")),
    });
  }

  createTaskStateRequestResponseStack() {
    const topic = new sns.Topic(this, "RequestResponseTopic", {});
    new stepfunctions.StateMachine(this, "RequestResponse", {
      definition: new stepfunctions.Wait(this, "Wait for Timestamps", {
        time: stepfunctions.WaitTime.secondsPath("$.timer_seconds"),
      }).next(
        new tasks.SnsPublish(this, "Send SNS Message", {
          topic,
          message: {
            type: stepfunctions.InputType.TEXT,
            value: "$.message",
          },
        })
      ),
    });
  }

  createTaskStateRunAJobSyncStack() {
    // don't create vpc, just look it up instead
    const batchVpc = ec2.Vpc.fromLookup(this, "BatchVPC", {
      vpcName: "Development",
    });

    // notification requirements
    const topic = new sns.Topic(this, "Topic");
    const notifyFailure = new tasks.SnsPublish(this, "Notify Failure", {
      topic,
      message: {
        type: stepfunctions.InputType.TEXT,
        value: `Batch job submitted through Step Functions failed`,
      },
    });
    const notifySuccess = new tasks.SnsPublish(this, "Notify Success", {
      topic,
      message: {
        type: stepfunctions.InputType.TEXT,
        value: `Batch job submitted through Step Functions succeeded`,
      },
    });

    // create a new ec2 role
    const role = new iam.Role(this, "BatchRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    const instanceRole = new iam.CfnInstanceProfile(this, "BatchInstance", {
      roles: [role.roleName],
    });

    const securityGroup = new ec2.SecurityGroup(this, "BatchSecurityGroup", {
      vpc: batchVpc,
    });
    const batchComputeEnvironment = new batch.CfnComputeEnvironment(
      this,
      "BatchComputeEnvironment",
      {
        type: "MANAGED",
        computeResources: {
          type: "EC2",
          minvCpus: 0,
          maxvCpus: 64,
          desiredvCpus: 0,
          instanceTypes: ["optimal"],
          subnets: batchVpc.publicSubnets.map((subnet) => subnet.subnetId),
          instanceRole: instanceRole.ref,
          securityGroupIds: [securityGroup.securityGroupId],
        },
      }
    );
    const batchJobQueue = new batch.CfnJobQueue(this, "BatchJobQueue", {
      priority: 1,
      computeEnvironmentOrder: [
        {
          order: 1,
          computeEnvironment: batchComputeEnvironment.ref,
        },
      ],
    });

    const jobDefinition = new batch.CfnJobDefinition(this, "JobDefinittion", {
      type: "container",
      containerProperties: {
        image: `137112412989.dkr.ecr.${this.region}.amazonaws.com/amazonlinux:latest`,
        command: ["echo", "Hello world"],
        vcpus: 2,
        memory: 2000,
      },
      timeout: {
        attemptDurationSeconds: cdk.Duration.minutes(2).toSeconds(),
      },
    });
    const taskSubmitJob = new tasks.BatchSubmitJob(this, "Submit Batch Job", {
      jobDefinitionArn: jobDefinition.ref,
      jobName: "BatchJobNotification",
      jobQueueArn: batchJobQueue.ref,
    })
      .addRetry({
        backoffRate: 1.5,
        maxAttempts: 2,
        errors: [stepfunctions.Errors.ALL],
        interval: cdk.Duration.seconds(30),
      })
      .addCatch(notifyFailure)
      .next(notifySuccess);

    new stepfunctions.StateMachine(this, "BatchJobNotification", {
      definition: taskSubmitJob,
    });
  }

  createCallbackWithTaskTokenStack() {
    const sqsQueue = new sqs.Queue(this, "SQSQueue", {
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: new sqs.Queue(this, "SQSQueueDLQ", {
          visibilityTimeout: cdk.Duration.seconds(30),
        }),
        maxReceiveCount: 1,
      },
    });

    const snsTopic = new sns.Topic(this, "SNSTopic", {
      displayName: "StepFunctionsTemplate-CallbackTopic",
    });

    const callbackWithTaskToken = new lambda.Function(
      this,
      "CallbackWithTaskToken",
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "callback-task-token.lambda_handler",
        code: lambda.Code.fromAsset("lambda"),
        timeout: cdk.Duration.seconds(25),
      }
    );

    // grant access resource that lambda needed
    sqsQueue.grantConsumeMessages(callbackWithTaskToken);
    callbackWithTaskToken.addEventSource(
      new lambdaEventSources.SqsEventSource(sqsQueue, {
        batchSize: 10,
      })
    );

    // step function states
    const notifyFailure = new tasks.SnsPublish(this, "Notify Failure", {
      topic: snsTopic,
      message: {
        type: stepfunctions.InputType.TEXT,
        value: `Task started by Step Functions failed.`,
      },
    });
    const notifySuccess = new tasks.SnsPublish(this, "Notify Success", {
      topic: snsTopic,
      message: {
        type: stepfunctions.InputType.TEXT,
        value: `Callback received. Task started by Step Functions succeeded.`,
      },
    });

    const startTaskAndWaitForCallback = new tasks.SqsSendMessage(
      this,
      "StartTaskAndWaitForCallback",
      {
        queue: sqsQueue,
        messageBody: {
          type: stepfunctions.InputType.OBJECT,
          value: {
            MessageTitle:
              "Task started by Step Functions. Waiting for callback with task token.",
            "TaskToken.$": stepfunctions.JsonPath.taskToken,
          },
        },
        integrationPattern:
          stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      }
    )
      .addCatch(notifyFailure)
      .next(notifySuccess);

    const stateMachine = new stepfunctions.StateMachine(
      this,
      "WaitForCallbackStateMachine",
      {
        definition: startTaskAndWaitForCallback,
      }
    );
  }
}
