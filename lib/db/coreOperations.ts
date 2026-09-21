import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./client";
import { User, UserEmailLock } from "./coreEntities";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
  return (
    anyErr?.name === "TransactionCanceledException" &&
    Boolean(anyErr?.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed"))
  );
}

/**
 * Creates a User row plus its UserEmailLock marker as one TransactWriteItems call — same
 * shape as commerceOperations.ts's createBookingOrder. The lock item's create() carries an
 * implicit attribute_not_exists condition on its key (email), so if another concurrent
 * request already won the race for this email, the WHOLE transaction fails atomically and
 * this call throws EmailAlreadyInUseError instead of silently minting a second User row for
 * the same address (see UserEmailLock's doc comment in coreEntities.ts for the bug this
 * closes). Both callers — app/api/auth/register/route.ts and server/authDynamo.ts's
 * Charisol provider — already do a pre-check query first (User.query.byEmail) purely as a
 * fast path for the common case; this transaction is what actually makes the guarantee.
 */
export class EmailAlreadyInUseError extends Error {
  constructor(email: string) {
    super(`Email already in use: ${email}`);
    this.name = "EmailAlreadyInUseError";
  }
}

export async function createUserWithEmailLock(params: {
  id: string;
  email: string;
  name?: string;
  image?: string;
  passwordHash?: string;
  isConfirmed: boolean;
  pendingPlan?: "PRO" | "ULTRA";
}): Promise<void> {
  const createUser = User.create(params).params();
  const createLock = UserEmailLock.create({ email: params.email, userId: params.id }).params();

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createUser as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createLock as any },
        ],
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) throw new EmailAlreadyInUseError(params.email);
    throw err;
  }
}
