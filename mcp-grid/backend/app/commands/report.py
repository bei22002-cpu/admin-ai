"""MCP Report Command - System vitals + capabilities report."""

import os
import platform
import time

import psutil


async def handle_report(args: str) -> dict:
    """Handle 'MCP report status' command.

    Returns comprehensive system vitals and MCP capabilities.
    """
    # System information
    cpu_percent = psutil.cpu_percent(interval=0.5)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot_time = psutil.boot_time()
    uptime_seconds = time.time() - boot_time

    # Network interfaces
    net_io = psutil.net_io_counters()

    # Battery (if available)
    battery_info = None
    try:
        battery = psutil.sensors_battery()
        if battery:
            battery_info = {
                "percent": battery.percent,
                "plugged_in": battery.power_plugged,
                "time_left": str(battery.secsleft) if battery.secsleft > 0 else "charging",
            }
    except Exception:
        pass

    # Process count
    process_count = len(psutil.pids())

    # Format uptime
    uptime_hours = int(uptime_seconds // 3600)
    uptime_mins = int((uptime_seconds % 3600) // 60)

    # Phase information
    current_phase = int(os.getenv("MCP_PHASE", "1"))
    phase_capabilities = {
        1: [
            "code", "search", "access", "scan",
            "alert", "report", "analyze",
        ],
        2: [
            "browser_control", "file_grid",
            "system_optimization",
        ],
        3: [
            "code_assimilation", "git_control",
            "debug_protocol",
        ],
        4: [
            "email_systems", "financial_control",
            "predictive_patterns",
        ],
    }

    available_commands = []
    for phase in range(1, current_phase + 1):
        available_commands.extend(phase_capabilities.get(phase, []))

    return {
        "message": (
            f"MCP System Report — Phase {current_phase} Active\n"
            f"CPU: {cpu_percent}% | RAM: {memory.percent}% "
            f"({memory.used // (1024**3)}GB/{memory.total // (1024**3)}GB)\n"
            f"Disk: {disk.percent}% | Uptime: {uptime_hours}h {uptime_mins}m\n"
            f"Processes: {process_count} | Commands: {len(available_commands)} available"
        ),
        "data": {
            "system": {
                "platform": platform.system(),
                "platform_version": platform.version(),
                "architecture": platform.machine(),
                "processor": platform.processor() or "Unknown",
                "hostname": platform.node(),
                "python_version": platform.python_version(),
            },
            "resources": {
                "cpu_percent": cpu_percent,
                "cpu_count": psutil.cpu_count(),
                "cpu_freq_mhz": (
                    psutil.cpu_freq().current if psutil.cpu_freq() else 0
                ),
                "memory_total_gb": round(memory.total / (1024**3), 2),
                "memory_used_gb": round(memory.used / (1024**3), 2),
                "memory_percent": memory.percent,
                "disk_total_gb": round(disk.total / (1024**3), 2),
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_percent": disk.percent,
            },
            "network": {
                "bytes_sent": net_io.bytes_sent,
                "bytes_recv": net_io.bytes_recv,
                "packets_sent": net_io.packets_sent,
                "packets_recv": net_io.packets_recv,
            },
            "battery": battery_info,
            "uptime": {
                "hours": uptime_hours,
                "minutes": uptime_mins,
                "total_seconds": int(uptime_seconds),
            },
            "processes": process_count,
            "mcp": {
                "phase": current_phase,
                "available_commands": available_commands,
                "total_commands": len(available_commands),
                "evolution_path": [
                    "Phase 1: Core 7 abilities",
                    "Phase 2: Browser + File + System control",
                    "Phase 3: Dev protocol + Git control",
                    "Phase 4: Total control + Predictive AI",
                ],
            },
        },
    }
