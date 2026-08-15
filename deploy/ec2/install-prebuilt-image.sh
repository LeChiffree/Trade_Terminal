#!/bin/sh
set -eu

stage_dir="${1:?Usage: install-prebuilt-image.sh STAGE_DIR [IMAGE_TAG]}"
image_tag="${2:-quantscope:ec2-only}"

case "$stage_dir" in
  /tmp/quantscope-prebuilt.*) ;;
  *)
    echo "Stage directory must be under /tmp/quantscope-prebuilt.*" >&2
    exit 2
    ;;
esac

test -d "$stage_dir/dist"
test -f "$stage_dir/deploy/ec2/scanner-entrypoint.sh"
test -f "$stage_dir/deploy/ec2/web-entrypoint.sh"

container_id=""
cleanup() {
  if [ -n "$container_id" ]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

container_id="$(
  docker create \
    --user root \
    --entrypoint /bin/sh \
    --volume "$stage_dir:/patch:ro" \
    quantscope:local \
    -c 'set -eu
        rm -rf /app/dist
        cp -a /patch/dist /app/dist
        cp /patch/deploy/ec2/scanner-entrypoint.sh /usr/local/bin/quantscope-scanner
        cp /patch/deploy/ec2/web-entrypoint.sh /usr/local/bin/quantscope-web
        chown -R 10001:10001 /app/dist /usr/local/bin/quantscope-scanner /usr/local/bin/quantscope-web
        chmod 0755 /usr/local/bin/quantscope-scanner /usr/local/bin/quantscope-web'
)"

docker start --attach "$container_id"
docker commit \
  --change 'USER quantscope' \
  --change 'ENTRYPOINT ["dumb-init","--","/usr/local/bin/quantscope-scanner"]' \
  "$container_id" "$image_tag" >/dev/null

docker image inspect "$image_tag" --format '{{.Id}} {{.Size}}'
