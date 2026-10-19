#!/usr/bin/env bash
# Creates (or updates) the least-privilege role the weekly stored-values cleanup runs as (.github/workflows/sweep-stored-values.yml).
# It can only: read the production tables, list/read/delete objects under the two stored-value prefixes. Trusted only for runs of
# plexo-web's main branch (the schedule) and manual runs on main. Safe to re-run.
#   AWS_PROFILE=plexo ./scripts/aws/create-sweep-role.sh
set -euo pipefail
ACCOUNT=919927637684
ROLE=github-actions-plexo-sweep
BUCKET=plexo-user-content
REGION=us-east-1
TABLES=(plexo-core plexo-ledger plexo-commerce plexo-content plexo-ops plexo-import plexo-sol)

trust=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":"repo:Challaris/plexo-web:ref:refs/heads/main"}}}]}
JSON
)
# one ARN per table
arns=""
for t in "${TABLES[@]}"; do arns="${arns}\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${t}\","; done
arns="${arns%,}"
policy=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"ReadRows","Effect":"Allow","Action":["dynamodb:Scan"],"Resource":[${arns}]},
 {"Sid":"ListStoredValues","Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::${BUCKET}","Condition":{"StringLike":{"s3:prefix":["private/db-values/*","private/design-systems/*"]}}},
 {"Sid":"ReadStoredValues","Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::${BUCKET}/private/db-values/*"},
 {"Sid":"RemoveStaleObjects","Effect":"Allow","Action":"s3:DeleteObject","Resource":["arn:aws:s3:::${BUCKET}/private/db-values/*","arn:aws:s3:::${BUCKET}/private/design-systems/*"]}
]}
JSON
)
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$trust"
else
  aws iam create-role --role-name "$ROLE" --description "Weekly cleanup of stored big values (plexo-web)" --assume-role-policy-document "$trust" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name sweep-stored-values --policy-document "$policy"
echo "arn:aws:iam::${ACCOUNT}:role/${ROLE}"
