podman run -it \
     --name kikoenai \
     --userns keep-id \
     -p 4545:8888 \
     -v /mnt/nas/junk/DLsite:/usr/src/kikoeru/VoiceWork \
	 -v asmr-tag-db:/usr/src/kikoeru/sqlite \
	 -v asmr-tag-config:/usr/src/kikoeru/config \
	 -v asmr-tag-cover:/usr/src/kikoeru/covers \
	 ghcr.io/rivers47/kikoenai:0.11.0
