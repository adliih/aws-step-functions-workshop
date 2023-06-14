import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as batch from "aws-cdk-lib/aws-batch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
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

    this.createHelloWorldStack();

    this.createTaskStateRequestResponseStack();

    // this.createTaskStateRunAJobSyncStack(); -- SKIPPED

    // this.createCallbackWithTaskTokenStack(); -- SKIPPED, bugged out, state machine suddenly gone

    this.createAwsSdkServiceIntegrationStack();

    this.createChoiceAndMapStack();

    this.createParallelStack();

    this.createInputAndOutputProcessingStack();

    this.createErrorHandlingStack();

    this.createManagingStateMachineAsIaC();
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

  createAwsSdkServiceIntegrationStack() {
    const detectSentimentState = new tasks.CallAwsService(
      this,
      "DetectSentiment",
      {
        service: "comprehend",
        action: "detectSentiment",
        iamResources: ["*"],
        parameters: {
          LanguageCode: "en",
          "Text.$": "$.Comment",
        },
      }
    );

    new stepfunctions.StateMachine(this, "SdkServiceIntegration", {
      definition: detectSentimentState,
    });
  }

  createChoiceAndMapStack() {
    const ddbTable = new dynamodb.Table(this, "DDBTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      readCapacity: 1,
      writeCapacity: 1,
      tableName: "MapStateTable",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lowPrioOrderDetected = new stepfunctions.Succeed(
      this,
      "Low Priority Order Detected",
      {}
    );
    const insertHighPrioOrder = new tasks.DynamoPutItem(
      this,
      "Insert High Priority Order",
      {
        table: ddbTable,
        item: {
          id: tasks.DynamoAttributeValue.fromString(
            stepfunctions.JsonPath.stringAt("$.customerId")
          ),
          customerId: tasks.DynamoAttributeValue.fromString(
            stepfunctions.JsonPath.stringAt("$.customerId")
          ),
          priority: tasks.DynamoAttributeValue.fromString(
            stepfunctions.JsonPath.stringAt("$.priority")
          ),
        },
      }
    );

    const priorityFilter = new stepfunctions.Choice(this, "Priority Filter", {})
      .when(
        stepfunctions.Condition.stringEquals(
          stepfunctions.JsonPath.stringAt("$.priority"),
          "HIGH"
        ),
        insertHighPrioOrder
      )
      .when(
        stepfunctions.Condition.stringEquals(
          stepfunctions.JsonPath.stringAt("$.priority"),
          "LOW"
        ),
        lowPrioOrderDetected
      )
      .afterwards();

    const iterateOverInputArray = new stepfunctions.Map(
      this,
      "Iterate Over Input Array",
      {
        inputPath: stepfunctions.JsonPath.stringAt("$.Data"),
        maxConcurrency: 2,
      }
    ).iterator(priorityFilter);

    new stepfunctions.StateMachine(this, "MapChoice", {
      definition: iterateOverInputArray,
    });
  }

  createParallelStack() {
    // Lambda Functions
    const sumFunction = new lambda.Function(this, "SumFunction", {
      functionName: "SumFunction",
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "sum.handler",
      code: lambda.Code.fromAsset("lambda"),
    });

    const avgFunction = new lambda.Function(this, "AvgFunction", {
      functionName: "AvgFunction",
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "avg.handler",
      code: lambda.Code.fromAsset("lambda"),
    });

    const maxMinFunction = new lambda.Function(this, "MaxMinFunction", {
      functionName: "MaxMinFunction",
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "max-min.handler",
      code: lambda.Code.fromAsset("lambda"),
    });

    const parallel = new stepfunctions.Parallel(this, "Parallel");

    parallel.branch(
      new tasks.LambdaInvoke(this, `Parallel 1`, {
        lambdaFunction: sumFunction,
        resultSelector: {
          "sum.$": stepfunctions.JsonPath.stringAt("$.Payload.sum"),
        },
      }),
      new tasks.LambdaInvoke(this, `Parallel 2`, {
        lambdaFunction: avgFunction,
        resultSelector: {
          "avg.$": stepfunctions.JsonPath.stringAt("$.Payload.avg"),
        },
      }),
      new tasks.LambdaInvoke(this, `Parallel 3`, {
        lambdaFunction: maxMinFunction,
        resultSelector: {
          "min.$": stepfunctions.JsonPath.stringAt("$.Payload.min"),
          "max.$": stepfunctions.JsonPath.stringAt("$.Payload.max"),
        },
      })
    );

    const stateMachine = new stepfunctions.StateMachine(
      this,
      "ParallelProcessingMachine",
      {
        definition: parallel,
        stateMachineType: stepfunctions.StateMachineType.EXPRESS,
      }
    );

    const apigwRole = new iam.Role(this, "API GW Role", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
    });
    apigwRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSStepFunctionsFullAccess")
    );
    // stateMachine.grantExecution(apigwRole);

    const apigw = new apigateway.RestApi(this, "APIGW Parallel", {});

    apigw.root.addResource("execute-async").addMethod(
      "POST",
      new apigateway.AwsIntegration({
        service: "states",
        action: "StartExecution",
        integrationHttpMethod: "POST",
        options: {
          credentialsRole: apigwRole,
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": "$util.parseJson($input.body)",
              },
            },
          ],
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
          },
        ],
      }
    );
    apigw.root.addResource("execute-sync").addMethod(
      "POST",
      new apigateway.AwsIntegration({
        service: "states",
        action: "StartSyncExecution",
        integrationHttpMethod: "POST",
        options: {
          credentialsRole: apigwRole,
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": "$util.parseJson($input.body)",
              },
            },
          ],
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
          },
        ],
      }
    );

    new cdk.CfnOutput(this, "StateMachineARN", {
      value: stateMachine.stateMachineArn,
    });
  }

  createInputAndOutputProcessingStack() {
    const lambdaHello = new lambda.Function(this, "Hello", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.InlineCode.fromInline(
        `exports.handler = (event, context, callback) => {\n callback(null, \"Hello, \" + event.who + \"!\");\n};`
      ),
    });

    const stateInvokeHello = new tasks.LambdaInvoke(this, "InvokeHello", {
      lambdaFunction: lambdaHello,
      inputPath: "$.lambda",
      resultPath: "$.data.lambdaresult",
      outputPath: "$.data",
      retryOnServiceExceptions: false,
    });
    const statePass = new stepfunctions.Pass(this, "Pass", {
      parameters: {
        "Sum.$": "States.MathAdd($.value1, $.value2)",
      },
    });
    new stepfunctions.StateMachine(this, "InputOutput", {
      definition: stateInvokeHello.next(statePass),
    });
  }

  createErrorHandlingStack() {
    const lambdaFail = new lambda.Function(this, "Fail", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.InlineCode.fromInline(
        `
exports.handler = async (event) => {
  function FooError(message) {
    this.name = 'CustomError';
    this.message = message;
  }
  FooError.prototype = new Error();

  const sleepSec = event.sleep || 0;

  await new Promise(r => setTimeout(r, sleepSec * 1000));

  throw new FooError("This is a Custom Error!");
};
`
      ),
    });

    const customErrorFallback = new stepfunctions.Pass(
      this,
      "CustomErrorFallback",
      {
        result: stepfunctions.Result.fromString(
          "This is a fallback from a custom Lambda function exception"
        ),
      }
    );
    const timeoutFallback = new stepfunctions.Pass(this, "TimeoutFallback", {
      result: stepfunctions.Result.fromString(
        "This is a fallback from a timeout error"
      ),
    });
    const catchAllFallback = new stepfunctions.Pass(this, "CatchAllFallback", {
      result: stepfunctions.Result.fromString(
        "This is a fallback from any error"
      ),
    });

    new stepfunctions.StateMachine(
      this,
      "ErrorHandlingStateMachineWithRetryCatch",
      {
        timeout: cdk.Duration.seconds(5),
        definition: new tasks.LambdaInvoke(this, "Start", {
          lambdaFunction: lambdaFail,
        })
          .addRetry({
            errors: ["CustomError"], // only CustomError name can be retried,
            interval: cdk.Duration.seconds(1),
            maxAttempts: 2,
            backoffRate: 2,
          })
          .addCatch(customErrorFallback, {
            errors: ["CustomError"],
          })
          .addCatch(timeoutFallback, {
            errors: [stepfunctions.Errors.TIMEOUT],
          })
          .addCatch(catchAllFallback, {
            errors: [stepfunctions.Errors.ALL],
          }),
      }
    );
  }

  createManagingStateMachineAsIaC() {
    const startState = new stepfunctions.Pass(this, "PassState", {
      result: { value: "Hello back to you!" },
    });

    const stateMachine = new stepfunctions.StateMachine(
      this,
      "MyStateMachine",
      {
        definition: startState,
        stateMachineType: stepfunctions.StateMachineType.EXPRESS,
      }
    );

    const api = new apigateway.StepFunctionsRestApi(
      this,
      "StepFunctionsRestApi",
      { stateMachine: stateMachine }
    );
  }
}
