"""
health_collector.py
-------------------
Collects information about the computer (CPU, memory, disk, battery,
processes and system details). There is NO Flask code here, so this
file can be tested alone:  python health_collector.py
"""

import os
import sys
import platform
import subprocess
import time
from datetime import datetime

import psutil


# ---------------------------------------------------------------
# Small helper functions
# ---------------------------------------------------------------

def convert_bytes_to_gb(number_of_bytes):
    """Turn bytes into GB (2 decimals). One helper so we never repeat the maths."""
    gigabytes = number_of_bytes / (1024 ** 3)
    return round(gigabytes, 2)


def get_memory_percent_for_sorting(process_info):
    """Tells sort() which value to compare. A named function is used instead of lambda."""
    return process_info["memory_percent"]


def format_uptime(total_seconds):
    """Turn seconds into a friendly text like '2 days, 3 hours, 5 minutes'."""
    total_seconds = int(total_seconds)
    days = total_seconds // 86400
    hours = (total_seconds % 86400) // 3600
    minutes = (total_seconds % 3600) // 60
    return str(days) + " days, " + str(hours) + " hours, " + str(minutes) + " minutes"


# ---------------------------------------------------------------
# Part A: one function per topic (each returns a dictionary)
# ---------------------------------------------------------------

def get_cpu_info():
    """CPU core counts and usage (overall and for each core)."""
    physical_cores = psutil.cpu_count(logical=False)
    logical_cores = psutil.cpu_count(logical=True)

    # interval=0.5 gives a real measurement; percpu=True gives one number per core.
    per_core_usage = psutil.cpu_percent(interval=0.5, percpu=True)

    # We work out the overall usage from the cores, so we only wait 0.5 seconds once.
    total_of_cores = 0
    for core_usage in per_core_usage:
        total_of_cores = total_of_cores + core_usage
    if len(per_core_usage) > 0:
        overall_usage = round(total_of_cores / len(per_core_usage), 1)
    else:
        overall_usage = 0.0

    return {
        "physical_cores": physical_cores,
        "logical_cores": logical_cores,
        "usage_percent": overall_usage,
        "per_core_usage": per_core_usage,
    }


def get_memory_info():
    """RAM and swap details."""
    ram = psutil.virtual_memory()
    swap = psutil.swap_memory()

    return {
        "total_gb": convert_bytes_to_gb(ram.total),
        "used_gb": convert_bytes_to_gb(ram.used),
        "available_gb": convert_bytes_to_gb(ram.available),
        "percent_used": ram.percent,
        "swap": {
            "total_gb": convert_bytes_to_gb(swap.total),
            "used_gb": convert_bytes_to_gb(swap.used),
            "free_gb": convert_bytes_to_gb(swap.free),
            "percent_used": swap.percent,
        },
    }


def get_disk_info():
    """Details of every disk we are allowed to read."""
    disks = []
    unreadable_disks = []

    for partition in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(partition.mountpoint)
        except PermissionError:
            # Some disks are locked by the OS. We note them and carry on.
            unreadable_disks.append(partition.mountpoint)
            continue
        except OSError:
            # Happens for things like an empty CD drive on Windows.
            unreadable_disks.append(partition.mountpoint)
            continue

        # Disks with a size of 0 (virtual ones) are useless for the dashboard.
        if usage.total == 0:
            continue

        disks.append({
            "mount_point": partition.mountpoint,
            "total_gb": convert_bytes_to_gb(usage.total),
            "used_gb": convert_bytes_to_gb(usage.used),
            "free_gb": convert_bytes_to_gb(usage.free),
            "percent_used": usage.percent,
        })

    return {"disks": disks, "unreadable_disks": unreadable_disks}


def get_battery_info():
    """Battery percent and plugged-in state, or a clear 'no battery' answer."""
    try:
        battery = psutil.sensors_battery()
    except AttributeError:
        # Some systems do not even have this function.
        battery = None

    # sensors_battery() gives None on computers without a battery (desktops).
    if battery is None:
        return {
            "has_battery": False,
            "percent": None,
            "plugged_in": None,
            "message": "No battery found",
        }

    if battery.power_plugged:
        message = "Charging / plugged in"
    else:
        message = "Running on battery"

    return {
        "has_battery": True,
        "percent": round(battery.percent, 1),
        "plugged_in": battery.power_plugged,
        "message": message,
    }


def get_top_processes(how_many=5):
    """The programs using the most memory."""
    all_processes = []

    for process in psutil.process_iter(["pid", "name", "memory_percent"]):
        try:
            process_info = process.info
            memory_percent = process_info["memory_percent"]
            name = process_info["name"]

            # Values can be None when we are not allowed to read the process.
            if memory_percent is None:
                continue
            if name is None:
                name = "unknown"

            all_processes.append({
                "pid": process_info["pid"],
                "name": name,
                "memory_percent": round(memory_percent, 2),
            })
        except psutil.NoSuchProcess:
            # The program closed while we were reading it.
            continue
        except psutil.AccessDenied:
            # The OS does not let us look at this program.
            continue

    # Biggest memory user first.
    all_processes.sort(key=get_memory_percent_for_sorting, reverse=True)

    top_processes = []
    for process_info in all_processes:
        if len(top_processes) >= how_many:
            break
        top_processes.append(process_info)

    return {"top_processes": top_processes}


def get_hostname():
    """Run the real 'hostname' command. Use a backup method if it fails."""
    try:
        result = subprocess.run(["hostname"], capture_output=True, text=True, timeout=5)
        hostname = result.stdout.strip()
        if result.returncode == 0 and hostname != "":
            return hostname
    except (OSError, subprocess.SubprocessError):
        # Command missing or it hung: fall through to the backup.
        pass

    # Backup method, so the program never crashes because of the hostname.
    return platform.node()


def get_current_user():
    """Windows stores the name in USERNAME, Mac/Linux in USER."""
    user_name = os.environ.get("USERNAME")
    if user_name is None:
        user_name = os.environ.get("USER")
    if user_name is None:
        user_name = "unknown"
    return user_name


def get_system_info():
    """General facts about the computer."""
    boot_timestamp = psutil.boot_time()
    boot_time = datetime.fromtimestamp(boot_timestamp).strftime("%Y-%m-%d %H:%M:%S")
    uptime_seconds = time.time() - boot_timestamp

    python_version = sys.version.split()[0]

    return {
        "os_name": platform.system(),
        "os_version": platform.release() + " (" + platform.version() + ")",
        "architecture": platform.machine(),
        "hostname": get_hostname(),
        "python_version": python_version,
        "boot_time": boot_time,
        "uptime": format_uptime(uptime_seconds),
        "current_user": get_current_user(),
    }


def get_network_info():
    """Total data sent and received since boot (bonus network card)."""
    try:
        counters = psutil.net_io_counters()
    except (OSError, AttributeError):
        counters = None

    if counters is None:
        return {"available": False, "message": "Network information not available"}

    # The raw byte counts let the web page work out the live speed
    # by comparing two readings that are a few seconds apart.
    return {
        "available": True,
        "bytes_sent": counters.bytes_sent,
        "bytes_received": counters.bytes_recv,
        "sent_gb": convert_bytes_to_gb(counters.bytes_sent),
        "received_gb": convert_bytes_to_gb(counters.bytes_recv),
        "packets_sent": counters.packets_sent,
        "packets_received": counters.packets_recv,
        "errors": counters.errin + counters.errout,
    }


def collect_full_report(how_many_processes=5):
    """Join every small report into one big dictionary."""
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "system": get_system_info(),
        "cpu": get_cpu_info(),
        "memory": get_memory_info(),
        "disks": get_disk_info(),
        "battery": get_battery_info(),
        "network": get_network_info(),
        "processes": get_top_processes(how_many_processes),
    }


# ---------------------------------------------------------------
# Run this file alone to print a short report in the terminal
# ---------------------------------------------------------------

def print_report(report):
    system = report["system"]
    cpu = report["cpu"]
    memory = report["memory"]
    battery = report["battery"]

    print("=" * 50)
    print("SYSTEM HEALTH REPORT  (" + report["generated_at"] + ")")
    print("=" * 50)

    print("Computer :", system["hostname"], "| User:", system["current_user"])
    print("OS       :", system["os_name"], system["os_version"], "|", system["architecture"])
    print("Python   :", system["python_version"])
    print("Boot time:", system["boot_time"], "| Uptime:", system["uptime"])

    print("\n--- CPU ---")
    print("Cores    :", cpu["physical_cores"], "physical,", cpu["logical_cores"], "logical")
    print("Usage    :", cpu["usage_percent"], "%")
    print("Per core :", cpu["per_core_usage"])

    print("\n--- MEMORY ---")
    print("Used     :", memory["used_gb"], "GB of", memory["total_gb"], "GB (", memory["percent_used"], "% )")
    print("Available:", memory["available_gb"], "GB")
    print("Swap     :", memory["swap"]["used_gb"], "GB of", memory["swap"]["total_gb"], "GB")

    print("\n--- DISKS ---")
    for disk in report["disks"]["disks"]:
        print(disk["mount_point"], ":", disk["used_gb"], "GB of", disk["total_gb"], "GB (", disk["percent_used"], "% )")
    for blocked_disk in report["disks"]["unreadable_disks"]:
        print(blocked_disk, ": could not be read")

    print("\n--- BATTERY ---")
    if battery["has_battery"]:
        print(battery["percent"], "% -", battery["message"])
    else:
        print(battery["message"])

    print("\n--- NETWORK ---")
    network = report["network"]
    if network["available"]:
        print("Sent     :", network["sent_gb"], "GB | Received:", network["received_gb"], "GB")
    else:
        print(network["message"])

    print("\n--- TOP PROCESSES (by memory) ---")
    for process in report["processes"]["top_processes"]:
        print(process["pid"], process["name"], process["memory_percent"], "%")


if __name__ == "__main__":
    print_report(collect_full_report())