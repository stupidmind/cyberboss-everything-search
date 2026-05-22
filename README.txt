Cyberboss + Everything MCP — 全盘秒搜文件
===========================================

把 Everything 引擎封装为 MCP (Model Context Protocol) 服务器，
LLM 直接调用工具，接收干净 JSON，不再需要手动教流程。
稳定、省 token、不挑模型。


前置条件
--------

1. 安装 Everything：https://www.voidtools.com/
2. 下载 es.exe（Everything 命令行工具）放到 Everything 目录
3. Node.js >= 22


部署（3 步）
-----------

1. 把 everything-mcp.js 放到项目目录

2. 在 .mcp.json 里注册：

   "es": {
     "command": "node",
     "args": ["项目路径/everything-mcp.js"]
   }

3. 重启 Claude Code / cyberboss 桥接


工具一览
--------

search — 全盘搜索文件
  keyword     (必填) 关键词，不区分大小写，支持部分匹配
  type        (可选) excel / word / pdf / image / ppt / text / video / audio
  path        (可选) 限定目录
  fuzzy       (可选) 模糊搜索，用通配符匹配
  max_results (可选) 最大返回数，默认 20，上限 50
  sort        (可选) date 按修改时间降序 / name 按文件名

count  — 快速统计匹配数量，不返回列表


为什么用 MCP 而不是写 instructions
----------------------------------

- LLM 直接调工具，不用在对话里手把手教搜索流程
- 返回结构化 JSON，LLM 不需要解析 es.exe 原始输出
- 工具描述自文档化，换模型不需要重新教
- 每次调用只消耗工具定义 + 结果 JSON，省 token
- Windows / WSL 路径问题由 MCP 内部处理，LLM 无感


如 es.exe 不在 E:/Everything/，设置环境变量：

  EVERYTHING_ES_PATH=C:/你的路径/es.exe
