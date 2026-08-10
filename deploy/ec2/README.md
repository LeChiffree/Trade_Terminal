# QuantScope EC2 scanner

This package can run either only the always-on scanner or the complete
QuantScope frontend and scanner in one EC2 container. The full deployment is
recommended when the EC2 address should serve the application directly.
Gemini stays on the manual UI endpoint and is not called by background cycles.

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
sudo install -m 0640 -o root -g 10001 deploy/ec2/scanner.env.example \
  /opt/quantscope/secrets/scanner.env
```

Populate `scanner.env` with the Gmail application credentials, the scanner
trigger shared with Sites, a current Sites bypass bearer token, and the Binance
USD-M Futures Demo credentials when mirror trading is enabled. Do not add
`Bearer ` in front of `SITES_SYNC_BEARER_TOKEN`; the service adds it.

The order mirror is hard-locked to `https://demo-fapi.binance.com`. Set
`BINANCE_FUTURES_TRADING_ENABLED=true`, `BINANCE_FUTURES_DEMO_ONLY=true`, and
choose the virtual isolated margin per trade with
`BINANCE_FUTURES_MARGIN_USDT`. Production Futures hosts are rejected.

For an assisted Windows-to-EC2 migration, upload the ignored `.env.local` and
`.scanner-service.ps1` files to the operator's private home directory, then run
`deploy/ec2/install-scanner-secret.sh`. It copies only the required values into
the root-owned secret file and removes both uploads.

## Full frontend and scanner start (recommended)

The scanner container is the only writer of scanner and paper-trading D1 state.
The web container uses a separate local data directory and reads the published
state through authenticated server-side upstream routes. Long scanner cycles
therefore cannot block the frontend, and no SQLite files are shared by two
processes.

```sh
docker compose -f deploy/ec2/compose-full.yaml build
docker compose -f deploy/ec2/compose-full.yaml up -d
docker compose -f deploy/ec2/compose-full.yaml ps
docker compose -f deploy/ec2/compose-full.yaml logs --tail=100 app
```

The application is published on host port 80. Restrict SSH to trusted source
addresses in the EC2 security group and expose only the intended HTTP/HTTPS
ports.

## Scanner-only start

From the project root:

```sh
docker compose -f deploy/ec2/compose.yaml build
docker compose -f deploy/ec2/compose.yaml up -d
docker compose -f deploy/ec2/compose.yaml ps
docker compose -f deploy/ec2/compose.yaml logs --tail=100 scanner
```

The scanner-only container binds its Worker only to `127.0.0.1` and publishes no host port.
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
