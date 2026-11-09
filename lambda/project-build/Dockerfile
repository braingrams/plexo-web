# ProjectBuildFn image. Build context: the repository root (see cdk/lib/compute-stack.ts).
FROM --platform=linux/amd64 node:24-bookworm-slim AS builder
WORKDIR /build

# The build Lambda's own code.
COPY lambda/project-build/package.json lambda/project-build/package-lock.json ./lambda/project-build/
RUN cd lambda/project-build && npm ci --no-audit --no-fund
COPY lambda/project-build ./lambda/project-build
COPY lib/projects/buildJob.ts lib/projects/diagnostics.ts lib/projects/envFileNames.ts ./lib/projects/
RUN cd lambda/project-build && node build.mjs

# The pre-installed dependency set: the project scaffold's own package.json, installed the
# same way a project's would be (registry only, no install scripts). A build whose
# package.json is satisfied by this set needs no install at all.
# Its npm cache is kept too (read-only in the running image): a build that adds a package
# starts from a fresh copy of it, so npm only downloads what's new.
COPY lib/projects/scaffold/template/package.json /opt/base/package.json
RUN cd /opt/base && npm install --ignore-scripts --no-audit --no-fund --loglevel=error --cache /opt/npm-cache

FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:24
RUN microdnf install -y tar gzip && microdnf clean all
# npm, for builds that add packages beyond the pre-installed set.
COPY --from=builder /usr/local/lib/node_modules/npm /opt/npm
COPY --from=builder /opt/base /opt/base
COPY --from=builder /opt/npm-cache /opt/npm-cache
COPY --from=builder /build/lambda/project-build/dist/ ${LAMBDA_TASK_ROOT}/
COPY --from=builder /build/lambda/project-build/node_modules/esbuild ${LAMBDA_TASK_ROOT}/node_modules/esbuild
COPY --from=builder /build/lambda/project-build/node_modules/@esbuild ${LAMBDA_TASK_ROOT}/node_modules/@esbuild
CMD ["index.handler"]
