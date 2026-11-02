FROM postgres:18.4
COPY test.conf /etc/pgbackrest/pgbackrest.conf
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends pgbackrest=2.60.0-1.pgdg13+1 \
    && rm -rf /var/lib/apt/lists/*
