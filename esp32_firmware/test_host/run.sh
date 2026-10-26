#!/bin/bash
# PC 上でファームウェアのロジックをテストする（g++ が必要。Windows なら WSL や MSYS2 で）
set -e
cd "$(dirname "$0")"
g++ -std=c++17 -Wall -Wextra -Wno-unused-parameter -I stubs -I ../src \
  test_main.cpp ../src/drive.cpp ../src/protocol.cpp ../src/params.cpp -o /tmp/fw_host_test
/tmp/fw_host_test
