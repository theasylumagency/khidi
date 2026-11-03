FROM postgres:18.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       pgbackrest=2.60.0-1.pgdg13+1 \
    && install -d -o postgres -g postgres -m 750 /var/run/pgbackrest /var/lib/pgbackrest \
    && rm -rf /var/lib/apt/lists/*
