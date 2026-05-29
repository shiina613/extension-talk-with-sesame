---
inclusion: auto
description: Quy tắc chia nhỏ nội dung khi ghi file dài để tránh lỗi truncation
---

# File Writing Strategy

## Quy tắc ghi file

Khi ghi nội dung vào file (fsWrite hoặc fsAppend):

1. **Nếu nội dung dự kiến > 50 dòng**: Chia nhỏ thành nhiều lần ghi (fsWrite lần đầu + fsAppend các phần tiếp theo)
2. **Mỗi lần ghi tối đa ~40-50 dòng** để tránh mất nội dung hoặc lỗi truncation
3. **Ưu tiên ghi theo block logic**: mỗi lần ghi là 1 function, 1 section, hoặc 1 component hoàn chỉnh — không cắt giữa chừng logic
4. **Verify sau khi ghi**: Nếu file quan trọng, đọc lại để đảm bảo nội dung đầy đủ
