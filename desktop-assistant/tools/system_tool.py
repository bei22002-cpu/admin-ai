"""
System information tool - CPU, memory, disk, processes.
"""

import platform


def get_system_info(info_type: str = "all") -> dict:
    """Get system information."""
    try:
        import psutil
    except ImportError:
        return {"status": "error", "message": "psutil not installed. Run: pip install psutil"}

    result = {"status": "success"}

    if info_type in ("cpu", "all"):
        result["cpu"] = {
            "percent": psutil.cpu_percent(interval=0.5),
            "count": psutil.cpu_count(),
            "count_logical": psutil.cpu_count(logical=True),
            "freq_mhz": round(psutil.cpu_freq().current) if psutil.cpu_freq() else None,
        }

    if info_type in ("memory", "all"):
        mem = psutil.virtual_memory()
        result["memory"] = {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "percent": mem.percent,
        }

    if info_type in ("disk", "all"):
        disk = psutil.disk_usage("/")
        result["disk"] = {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": round(disk.percent, 1),
        }

    if info_type in ("processes", "all"):
        procs = []
        for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            try:
                info = proc.info
                if info.get("cpu_percent", 0) > 0 or info.get("memory_percent", 0) > 0.5:
                    procs.append(info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        procs.sort(key=lambda p: p.get("cpu_percent", 0), reverse=True)
        result["processes"] = procs[:15]

    if info_type == "all":
        result["platform"] = {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        }

    return result
