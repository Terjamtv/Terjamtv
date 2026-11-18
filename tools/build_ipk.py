#!/usr/bin/env python3
"""
LG webOS IPK Builder
Builds a valid .ipk installer for LG webOS TV directly without needing ares-cli!
"""

import os
import tarfile
import io
import time

def create_ar_header(filename, size):
    # Standard UNIX ar header (60 bytes)
    # File name (16 bytes, padded with spaces or slash)
    fn = (filename + "/").ljust(16)
    # File modification timestamp (12 bytes)
    mtime = str(int(time.time())).ljust(12)
    # Owner ID (6 bytes)
    uid = "0".ljust(6)
    # Group ID (6 bytes)
    gid = "0".ljust(6)
    # File mode (8 bytes, octal)
    mode = "100644".ljust(8)
    # File size in bytes (10 bytes)
    fsize = str(size).ljust(10)
    # Trailing magic (2 bytes)
    magic = "`\n"
    
    header = (fn + mtime + uid + gid + mode + fsize + magic).encode('ascii')
    assert len(header) == 60
    return header

def build_webos_ipk(src_dir, output_ipk_path):
    print(f"📦 Packaging LG webOS app from: {src_dir}")
    
    # 1. debian-binary
    debian_binary = b"2.0\n"
    
    # 2. control.tar.gz
    control_content = (
        "Package: com.translatetv.app\n"
        "Version: 1.0.0\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Architecture: all\n"
        "Maintainer: TranslateTV\n"
        "Description: TranslateTV - Real-time smart TV translation app for LG webOS\n"
    ).encode('utf-8')
    
    control_buf = io.BytesIO()
    with tarfile.open(fileobj=control_buf, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="./control")
        ti.size = len(control_content)
        ti.mtime = int(time.time())
        ti.mode = 0o644
        tar.addfile(ti, io.BytesIO(control_content))
    control_tar_gz = control_buf.getvalue()
    
    # 3. data.tar.gz
    data_buf = io.BytesIO()
    app_base_in_data = "usr/palm/applications/com.translatetv.app"
    with tarfile.open(fileobj=data_buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(src_dir):
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, src_dir).replace("\\", "/")
                target_path = f"{app_base_in_data}/{rel_path}"
                tar.add(abs_path, arcname=target_path)
    data_tar_gz = data_buf.getvalue()
    
    # 4. Combine into AR archive (.ipk)
    ipk_data = bytearray(b"!<arch>\n")
    
    for fname, content in [
        ("debian-binary", debian_binary),
        ("control.tar.gz", control_tar_gz),
        ("data.tar.gz", data_tar_gz),
    ]:
        header = create_ar_header(fname, len(content))
        ipk_data.extend(header)
        ipk_data.extend(content)
        # Pad to even boundary if needed
        if len(content) % 2 != 0:
            ipk_data.extend(b"\n")
            
    with open(output_ipk_path, "wb") as f:
        f.write(ipk_data)
        
    print(f"🎉 IPK Package built successfully: {output_ipk_path} ({len(ipk_data)} bytes)")

if __name__ == "__main__":
    src = "d:/Trans/tv-webos"
    out = "d:/Trans/com.translatetv.app_1.0.0_all.ipk"
    build_webos_ipk(src, out)
