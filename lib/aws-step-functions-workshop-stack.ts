import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";

export class AwsStepFunctionsWorkshopStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'AwsStepFunctionsWorkshopQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // const timerStateMachine = new stepfunctions.StateMachine(
    //   this,
    //   "TimerStateMachine",
    //   {
    //     removalPolicy: cdk.RemovalPolicy.DESTROY,
    //     definition: new stepfunctions.Wait(this, "Wait for Timer", {
    //       time: stepfunctions.WaitTime.secondsPath("$.timer_seconds"),
    //     }).next(new stepfunctions.Succeed(this, "Success")),
    //   }
    // );

    // Basic Task State - Request Response
    const topic = new sns.Topic(this, "RequestResponseTopic", {});
    const taskStateReqResp = new stepfunctions.StateMachine(
      this,
      "RequestResponse",
      {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      }
    );
  }
}
