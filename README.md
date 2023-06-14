# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

# Workshop link

https://catalog.us-east-1.prod.workshops.aws/workshops/9e0368c0-8c49-4bec-a210-8480b51a34ac/en-US/basics/flow-state/parallel-state/step-4

# Example StateMachine Payloads

## TimerStateMachine

```json
{
  "timer_seconds": 3
}
```

## RequestResponse

```json
{
  "timer_seconds": 2,
  "message": "Sent via Step Function"
}
```

## MapChoice

```json
{
  "Data": [
    {
      "priority": "HIGH",
      "customerId": "1"
    },
    {
      "priority": "LOW",
      "customerId": "2"
    },
    {
      "priority": "HIGH",
      "customerId": "2"
    }
  ]
}
```

## SdkServiceIntegration

```json
{
  "Comment": "I'm so sad. How to make myself happy?"
}
```

## ParallelProcessingMachine - APIGW Parallel (API Gateway)

```json
{
  "input": "{\"data\":[1,2,3]}",
  "name": "from-api-gw",
  "stateMachineArn": "<ParallelProcessingMachine ARN>"
}
```

## InputOutput

```json
{
  "lambda": {
    "who": "Adli"
  },
  "data": {
    "value1": 3,
    "value2": 4
  }
}
```

## ErrorHandlingStateMachineWithRetryCatch

Without sleep

```json
{}
```

With 10 seconds sleep

```json
{
  "sleep": 10
}
```

## MyStateMachine - StepFunctionsRestApi (API Gateway)

It doesn't require any payload
