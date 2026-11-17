# EC2 automatic deployment

The EC2 host uses `everythingticket-auto-deploy.timer` to check the public
`main` branch every five minutes (with up to 45 seconds of jitter). It runs
the repository's tracked `dist/main.js` entry point, including the background
worker.

For a new revision, it:

1. fetches `main` into a separate source checkout;
2. builds a separate release directory;
3. applies Prisma migrations;
4. switches the service to that release and restarts it;
5. checks `http://127.0.0.1:3000/health` for up to two minutes before
   considering it active.

If the health check fails, it switches back to the prior release. Releases are
kept until deliberately cleaned up, so the rollback history remains available.
Logs are available through:

```bash
journalctl -u everythingticket-auto-deploy.service -n 100 --no-pager
systemctl list-timers everythingticket-auto-deploy.timer
```

The initial installation must be performed through AWS Systems Manager, using
the files in this directory. The server only follows `main`, so unmerged pull
requests never reach the live API.
