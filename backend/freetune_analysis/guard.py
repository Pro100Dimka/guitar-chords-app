"""Independent parent-death guard; remains responsive during native model calls."""

import argparse
import os
import signal
import time

import psutil


def alive(pid, created):
    try:
        process = psutil.Process(pid)
        return process.create_time() == created and process.status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def guard(parent_pid, parent_created, worker_pid, worker_created, worker_group=None):
    try:
        isolated_group = os.name == "posix" and (worker_group == worker_pid or os.getpgid(worker_pid) == worker_pid)
    except ProcessLookupError:
        isolated_group = False
    while True:
        worker_alive = alive(worker_pid, worker_created)
        if not worker_alive or not alive(parent_pid, parent_created):
            if isolated_group:
                try:
                    # If the worker itself was OOM-killed, its process group may still
                    # contain FFmpeg. Avoid touching an unrelated reused worker PID.
                    if psutil.pid_exists(worker_pid) and psutil.Process(worker_pid).create_time() != worker_created:
                        return
                    os.killpg(worker_pid, signal.SIGKILL)
                except (ProcessLookupError, psutil.NoSuchProcess):
                    pass
                return
            if not worker_alive:
                return
            try:
                worker = psutil.Process(worker_pid)
                for child in worker.children(recursive=True):
                    if child.pid != os.getpid():
                        try:
                            child.kill()
                        except psutil.NoSuchProcess:
                            pass
                worker.kill()
            except psutil.NoSuchProcess:
                pass
            return
        time.sleep(0.25)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent", type=int, required=True)
    parser.add_argument("--parent-created", type=float, required=True)
    parser.add_argument("--worker", type=int, required=True)
    parser.add_argument("--worker-created", type=float, required=True)
    parser.add_argument("--worker-group", type=int)
    args = parser.parse_args()
    guard(args.parent, args.parent_created, args.worker, args.worker_created, args.worker_group)


if __name__ == "__main__":
    main()
