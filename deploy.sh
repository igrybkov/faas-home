#!/usr/bin/env bash -e

docker buildx create --name mybuilder || true
docker buildx use mybuilder

rm -rf build/
faas-cli template pull
faas-cli build --shrinkwrap

function buildFn {
    local dir="$1"
    local fnName="$(basename "$dir")"
    local REPO="registry.home.grybkov.dev/openfaas-fn"
    cd $dir
    docker buildx build --platform linux/arm/v7 -t "${REPO}/${fnName}:latest" --push .
}
export -f buildFn

find ./build -type d -maxdepth 1 -mindepth 1 -exec bash -c 'buildFn "$0"' {} \;

faas-cli deploy
