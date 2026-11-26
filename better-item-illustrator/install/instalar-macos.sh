#!/bin/sh
# Instala o painel Better Item no Illustrator (macOS), sem assinatura. Uso: sh install/instalar-macos.sh [--link]
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/better-item-illustrator"
for v in 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if [ "$1" = "--link" ]; then ln -s "$SRC" "$DEST"; else mkdir -p "$DEST"; cp -R "$SRC/CSXS" "$SRC/client" "$SRC/host" "$SRC/.debug" "$DEST/"; fi
echo "Instalado em $DEST. Reinicie o Illustrator e abra Janela > Extensões > Better Item."
