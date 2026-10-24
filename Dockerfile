# AltStack Game Producer, hosted image (Railway or any container host).
# Includes Godot (Forge) built in. Blender (Molder) is optional because it adds ~1 GB: build with --build-arg WITH_BLENDER=1.
FROM node:22-bookworm-slim

ARG WITH_BLENDER=0
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates unzip xz-utils ffmpeg libfontconfig1 libgl1 libxcursor1 libxi6 libxinerama1 libxrandr2 libasound2 \
    && if [ "$WITH_BLENDER" = "1" ]; then apt-get install -y --no-install-recommends libxrender1 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libegl1; fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY studio ./studio
COPY web ./web
COPY vendor ./vendor
COPY LICENSE NOTICE.md README.md ./

# Official, checksum-verified builds go to /opt/altstack (outside the data volume, which is mounted over /data at run time).
RUN GP_HOME=/opt/altstack node bin/game-producer.js install godot \
 && ln -s "$(find /opt/altstack/tools/godot -type f -name 'Godot_v*' | head -1)" /usr/local/bin/godot \
 && if [ "$WITH_BLENDER" = "1" ]; then GP_HOME=/opt/altstack node bin/game-producer.js install blender \
    && ln -s "$(find /opt/altstack/tools/blender -type f -name blender | head -1)" /usr/local/bin/blender; fi \
 && useradd --create-home --uid 10001 producer && mkdir -p /data && chown producer /data

ENV GP_HOME=/data NODE_ENV=production GP_HOST=0.0.0.0
USER producer
VOLUME /data
EXPOSE 8080
# GP_ACCESS_TOKEN (required), GP_PROVIDER + GP_API_KEY (the one key) are set as service variables.
CMD ["sh", "-c", "GP_PORT=${PORT:-8080} node bin/game-producer.js start --no-open"]
