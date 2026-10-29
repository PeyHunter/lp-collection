# Self-hosted on the home k3s cluster, behind a Cloudflare Tunnel

LP-Collection runs with its PostgreSQL database and photo storage on the owner's own k3s cluster rather than on a cloud host. It is reachable at lp-collection.peytonhunter.com through a Cloudflare Tunnel, because peytonhunter.com's DNS is already on Cloudflare and a tunnel needs no open ports on the home network. Invited Users outside the owner's Tailscale network can reach it this way. Nightly backups go to the other k3s node and are kept for 30 days.
