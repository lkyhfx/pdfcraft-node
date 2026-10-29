FROM node:24-bookworm-slim
WORKDIR /test
COPY npm-dist/*.tgz /artifacts/
COPY tests /test/tests
COPY npm/package.json /package-config.json
RUN node -e "const fs=require('fs'),{execFileSync}=require('child_process');const version=require('/package-config.json').version;const main='lkyhfx-pdfcraft-node-'+version+'.tgz';const platform='lkyhfx-pdfcraft-node-linux-'+process.arch+'-gnu-'+version+'.tgz';execFileSync('npm',['install','--offline','--ignore-scripts','--omit=optional','/artifacts/'+main,'/artifacts/'+platform],{stdio:'inherit'})"
ENV PDFCRAFT_TEST_PACKAGE=/test/node_modules/@lkyhfx/pdfcraft-node
RUN ! command -v gs && ! command -v mutool && ! command -v cargo
RUN node --test --test-isolation=none tests/*.test.js
