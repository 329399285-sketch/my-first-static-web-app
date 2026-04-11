# Word Card Studio（Azure Static Web Apps）

这个项目支持：
- 用户注册/登录（仅账号+密码，不做邮箱或短信验证）
- 每个用户独立文档空间（云端隔离）
- 管理员可切换目标用户空间并代上传 Word 文档
- 云端同步与 PDF 导出

## 账号与权限规则

- 注册接口：`POST /api/auth/register`
- 登录接口：`POST /api/auth/login`
- 当前用户：`GET /api/auth/me`
- 退出登录：`POST /api/auth/logout`
- 用户列表（仅管理员）：`GET /api/users`
- 文档接口（按用户空间隔离）：`/api/documents`

默认规则：
- 第一个注册账号自动成为 `admin`
- 后续注册账号默认为 `user`
- `admin` 可通过 `targetUser` 切换管理目标用户空间

## Azure 必填配置

在 Azure 门户进入：
`Static Web App -> Configuration -> Application settings`

新增这些变量：
- `AZURE_STORAGE_CONNECTION_STRING`：Azure Storage 连接串（必填）
- `DOCS_CONTAINER_NAME`：文档容器名（可选，默认 `word-card-documents`）
- `AUTH_CONTAINER_NAME`：账号容器名（可选，默认 `word-card-auth`）
- `AUTH_SESSION_DAYS`：登录态有效天数（可选，默认 `30`）
- `ADMIN_USERNAMES`：管理员用户名列表（可选，逗号分隔，默认包含 `xiaoyang`）
- `DEFAULT_ADMIN_USERNAME`：默认管理员用户名（可选，默认 `xiaoyang`）
- `DEFAULT_ADMIN_PASSWORD`：默认管理员密码（可选，默认 `000823`）

保存后重新部署（或等待自动部署）即可生效。

## 使用流程

1. 首次进入页面，先注册账号并登录。
2. 管理员账号登录后，可在顶部“管理空间”选择任意用户。
3. 上传/解析 Word 文档时，数据会写入当前选中的用户空间。
4. 其他设备登录同一账号后，点击“云端同步”即可拉取数据。

## 安全说明（当前实现）

当前是轻量账号系统，适合个人/教学/小规模使用。
生产环境建议继续加强：密码强度策略、限流、防爆破、审计日志、管理员初始化策略等。
