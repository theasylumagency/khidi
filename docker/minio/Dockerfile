# The upstream binary images were removed. Build the pinned security release from source.
FROM golang:1.24.8-alpine3.22 AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /source
RUN git init && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth 1 origin 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
    && git checkout --detach FETCH_HEAD
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags "-s -w -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CommitID=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" -o /minio .
RUN GOBIN=/tools go install github.com/minio/mc@7394ce0dd2a80935aded936b09fa12cbb3cb8096
FROM alpine:3.22.2
RUN apk add --no-cache ca-certificates curl && mkdir /data && chown 10001:10001 /data
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /tools/mc /usr/local/bin/mc
COPY --from=build /source/LICENSE /source/CREDITS /licenses/
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
