// Sets or removes provisioned concurrency on the server function's live alias.
//
// Why this is a separate function: the server function must not be able to change its own
// warm-copy count (that controls cost). Only this function holds the permission, and the
// server function may only invoke it (CDK: compute-stack.ts "PcScalerFn").
//
// The target function and alias come from this function's environment, never from the request,
// and the requested count is checked against a fixed range.
const { LambdaClient, PutProvisionedConcurrencyConfigCommand, DeleteProvisionedConcurrencyConfigCommand } = require("@aws-sdk/client-lambda");

const MAX_PROVISIONED = 200;

// `client` is injected so tests can pass a fake; Lambda uses the real one below.
function makeHandler(client) {
  return async (event) => handle(client, event);
}

async function handle(client, event) {
  const target = process.env.TARGET_FUNCTION_NAME;
  const qualifier = process.env.TARGET_ALIAS || "live";
  const count = event && event.provisionedConcurrency;

  if (!Number.isInteger(count) || count < 0 || count > MAX_PROVISIONED) {
    return { ok: false, error: `provisionedConcurrency must be an integer from 0 to ${MAX_PROVISIONED}.` };
  }

  if (count === 0) {
    try {
      await client.send(new DeleteProvisionedConcurrencyConfigCommand({ FunctionName: target, Qualifier: qualifier }));
    } catch (err) {
      // Nothing to remove when provisioned concurrency was never set.
      if (err.name !== "ResourceNotFoundException") throw err;
    }
    return { ok: true, applied: 0 };
  }

  await client.send(
    new PutProvisionedConcurrencyConfigCommand({ FunctionName: target, Qualifier: qualifier, ProvisionedConcurrentExecutions: count }),
  );
  return { ok: true, applied: count };
}

exports.makeHandler = makeHandler;
exports.handler = makeHandler(new LambdaClient({}));
