# QuantScope EC2 scanner

This package moves only the always-on scanner, email alerts, and paper-trading
engine to EC2. The existing Sites UI/API and its D1 read model remain unchanged.
Gemini stays on the manual UI endpoint and is not called by the EC2 process.

## Recommended host

- Ubuntu 24.04 LTS or Amazon Linux 2023, x86_64
- `t3.small`, 30 GB encrypted gp3 EBS
- Docker Engine with the Compose v2 plugin
- No inbound security-group rules; use AWS Systems Manager Session Manager
- Outbound HTTPS access to Binance, the Sites sync endpoint, Gmail SMTP, and
  market-context providers

## Host directories

Create these paths before the first start:

```sh
sudo install -d -m 0750 -o 10001 -g 10001 /opt/quantscope/data
sudo install -d -m 0700 /opt/quantscope/secrets
sudo install -m 0600 deploy/ec2/scanner.env.example \
  /opt/quantscope/secrets/scanner.env
```

Populate `scanner.env` with the Gmail application credentials, the scanner
trigger shared with Sites, and a current Sites bypass bearer token. Do not add
`Bearer ` in front of `SITES_SYNC_BEARER_TOKEN`; the service adds it.

## First start

From the project root:

```sh
docker compose -f deploy/ec2/compose.yaml build
docker compose -f deploy/ec2/compose.yaml up -d
docker compose -f deploy/ec2/compose.yaml ps
docker compose -f deploy/ec2/compose.yaml logs --tail=100 scanner
```

The container binds its Worker only to `127.0.0.1` and publishes no host port.
It writes scanner and paper-trading state under `/opt/quantscope/data`.

## State transfer and cutover

1. Build and validate the EC2 image before stopping Windows.
2. Run `scripts/export-scanner-state.ps1 -KeepStopped` as Administrator on the
   Windows host. This produces a consistent archive under `outputs/ec2`.
3. Copy the archive to EC2 and extract its contents into
   `/opt/quantscope/data` while the container is stopped.
4. Start the EC2 container and confirm that the health check is healthy, scan
   counters advance, paper positions match, and Sites receives a fresh
   heartbeat.
5. Keep the Windows scheduled task stopped. There must be exactly one active
   scanner to prevent duplicate emails and paper trades.

If EC2 validation fails, stop the EC2 container and start the Windows scheduled
task again. The export script restarts Windows automatically unless
`-KeepStopped` is supplied.

## Operations

```sh
docker compose -f deploy/ec2/compose.yaml ps
docker compose -f deploy/ec2/compose.yaml logs -f scanner
docker compose -f deploy/ec2/compose.yaml restart scanner
docker compose -f deploy/ec2/compose.yaml pull
```

Configure CloudWatch alarms for instance status-check failure and low disk
space. Schedule EBS snapshots or AWS Backup independently of the container.
