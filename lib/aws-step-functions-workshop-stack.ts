import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";

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
  }
}
