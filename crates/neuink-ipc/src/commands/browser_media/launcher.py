"""Network boundary around the bundled, unmodified yt-dlp extractor implementation."""
import ipaddress
import runpy
import socket
import sys

_resolve = socket.getaddrinfo


def _attach_process_job():
    # Kill QuickJS descendants too when the Rust owner cancels/kills this process.
    # This is lifecycle management, not a general execution sandbox.
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                    ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                    ("scheduling", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("basic", BasicLimits), ("io", IoCounters),
                    ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                    ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise OSError("Cannot initialize reader process lifecycle")
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        kernel.CloseHandle(job)
        raise OSError("Cannot bound reader process lifecycle")
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        kernel.CloseHandle(job)
        raise OSError("Cannot attach reader process lifecycle")
    return job  # Kept open until process exit; the handle is not inheritable.


def _public_resolution(host, port, *args, **kwargs):
    # Every urllib connection and redirect resolves here. Return these exact checked
    # addresses, so the subsequent connect does not make a second DNS lookup.
    if port not in (443, "443", "https"):
        raise OSError("Only public HTTPS is allowed")
    addresses = _resolve(host, port, *args, **kwargs)
    for address in addresses:
        value = ipaddress.ip_address(address[4][0])
        if isinstance(value, ipaddress.IPv6Address) and value.ipv4_mapped:
            value = value.ipv4_mapped
        if not value.is_global or value.is_multicast or value.is_reserved:
            raise OSError("Non-public network target is blocked")
    if not addresses:
        raise OSError("No public network target")
    return addresses


if __name__ == "__main__":
    _process_job = _attach_process_job()
    socket.getaddrinfo = _public_resolution
    sys.argv[0] = "yt-dlp"
    runpy.run_module("yt_dlp", run_name="__main__")
