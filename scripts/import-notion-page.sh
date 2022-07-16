#!/usr/bin/env bash
set -x

rm -r public/
ZIPFILE="$1"
unzip -n "$1" -d public
EXPORTNAME=$(basename public/*/)

mv "public/$EXPORTNAME.html" public/index.html
mv "public/$EXPORTNAME" public/images

export LINKNAME=$(node --eval "console.log(encodeURIComponent(process.argv[1]))" "$EXPORTNAME")
perl -p -e 's/$ENV{LINKNAME}/images/g' -i public/index.html