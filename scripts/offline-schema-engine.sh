#!/bin/sh
# Náhrada schema-engine pro prostředí bez přístupu na binaries.prisma.sh.
# `prisma generate` engine nepotřebuje; migrace aplikuje scripts/migrate.mjs.
echo "schema-engine není v tomto prostředí k dispozici" >&2
exit 1
