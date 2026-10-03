"""Offline checks of the packaged extractor's actual connection path; never contacts a site."""
import importlib.util
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch

from yt_dlp.networking._helper import create_connection

spec = importlib.util.spec_from_file_location("media_launcher", Path(__file__).with_name("launcher.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class NetworkBoundaryTests(unittest.TestCase):
    def test_private_literals_and_mixed_dns_answers_are_blocked(self):
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1",
                   "::1", "::ffff:127.0.0.1", "fc00::1", "224.0.0.1", "192.0.2.1"):
            private = (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))
            for addresses in ([private], [public_address(), private]):
                with patch.object(policy, "_resolve", return_value=addresses):
                    with self.assertRaises(OSError):
                        policy._public_resolution(ip, 443)

    def test_checked_dns_results_are_the_exact_addresses_passed_to_connect(self):
        addresses = [public_address()]
        sentinel = object()
        with patch.object(policy, "_resolve", return_value=addresses) as resolve:
            with patch.object(socket, "getaddrinfo", policy._public_resolution):
                seen = []
                result = create_connection(("public.example", 443),
                    _create_socket_func=lambda address, _timeout, _source: seen.append(address) or sentinel)
        self.assertIs(result, sentinel)
        self.assertIs(seen[0], addresses[0])
        resolve.assert_called_once()

    def test_redirect_resolution_is_revalidated_and_other_ports_are_rejected(self):
        with patch.object(policy, "_resolve", side_effect=[
            [public_address()], [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        ]) as resolve:
            policy._public_resolution("public.example", 443)
            with self.assertRaises(OSError):
                policy._public_resolution("redirect.example", 443)
            self.assertEqual(resolve.call_count, 2)
        with patch.object(policy, "_resolve") as resolve:
            for port in (80, 22, 8080):
                with self.assertRaises(OSError):
                    policy._public_resolution("public.example", port)
            resolve.assert_not_called()

    @unittest.skipUnless(sys.platform == "win32", "Windows bundled reader lifecycle")
    def test_cancelling_reader_also_terminates_its_runtime_child(self):
        import ctypes
        from ctypes import wintypes
        program = (
            "import runpy, subprocess, sys, time; "
            f"p = runpy.run_path({str(Path(__file__).with_name('launcher.py'))!r}); "
            "job = p['_attach_process_job'](); "
            "child = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'import time; time.sleep(30)']); "
            "print(child.pid, flush=True); time.sleep(30)"
        )
        reader = subprocess.Popen([sys.executable, "-I", "-B", "-c", program],
                                  stdout=subprocess.PIPE, text=True, creationflags=0x08000000)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = None
        try:
            child_pid = int(reader.stdout.readline())
            handle = kernel.OpenProcess(0x100001, False, child_pid)
            self.assertTrue(handle)
            reader.kill()
            reader.wait(timeout=3)
            self.assertEqual(kernel.WaitForSingleObject(handle, 3000), 0)
        finally:
            if reader.poll() is None:
                reader.kill()
                reader.wait(timeout=3)
            reader.stdout.close()
            if handle:
                kernel.TerminateProcess(handle, 1)
                kernel.CloseHandle(handle)


def public_address():
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.215.14", 443))


if __name__ == "__main__":
    unittest.main()
