# 附近共享功能（本地接入说明）

页面使用 Leaflet + OpenStreetMap 展示地图，Supabase Auth/Postgres 提供跨用户共享。定位只在用户点击“定位并查看附近”时触发。发布时经纬度四舍五入到 0.01 度（大约 1 公里量级），不会上传精确坐标。

## 配置步骤

1. 在 Supabase 项目中启用 Authentication 的 Anonymous Sign-Ins 和 Email 登录；在 Authentication 设置中开启 **Manual Linking**，让当前设备的匿名用户绑定邮箱时保留原来的用户 ID。
2. 首次设置时在 SQL Editor 执行 `nearby-sharing.sql`。如果共享表已经创建，执行 `nearby-sharing-allow-ml.sql` 更新单位约束。
3. 将 `nearby-config.example.js` 复制到项目根目录为 `nearby-config.js`。
4. 填入 Project URL 和 **Publishable key**。不要填 `service_role` 或 Secret key。
5. 在 Authentication 的 URL Configuration 中，将部署站点地址设为 Site URL，并加入 Redirect URLs（例如 `https://你的域名/**`）。通过 HTTPS 页面访问；双击 `file://` 页面不能使用邮箱验证回跳。

## 账号身份（第一步）

个人信息页提供“绑定邮箱”和“已有邮箱登录”。当前设备绑定邮箱会把已有匿名身份升级为可找回账号，保留用户 ID 及其共享记录。其他设备可使用已有邮箱登录。

这一阶段只建立可找回的账号身份，不上传库存、个人资料、自定义食材或饮食记录；这些数据仍保存在当前设备。开始云端同步前，需要另行实现首次数据迁移和冲突处理。不要在浏览器中使用 Supabase `service_role` 或 Secret key。

匿名身份只保存在当前设备，清除站点数据或换设备后无法管理原设备发布的条目。当前可发布 3 天内到期的冰箱食品（过期食品不列出），支持克、个和饮料毫升；已创建共享表的项目需要执行 `nearby-sharing-allow-ml.sql` 才能发布毫升单位。当前 MVP 支持发布和浏览地图/列表，尚无预约或聊天。OSM 公共地图瓦片适合原型和低流量使用；高流量服务应换成符合需求的地图服务。

## 私人数据云端表（第二步）

`migrations/202610260001_fridge_cloud_sync.sql` 建立库存、自定义食材、饮食记录和个人资料表。每条记录都有 `owner_id`、稳定 ID、版本号；可删除的数据使用 `deleted_at` 软删除，便于离线设备同步删除。每张表启用 RLS，只能由所属账号读写。删除 Auth 用户时，外键级联清除这些个人数据和其拥有的共享记录。

在 Supabase SQL Editor 中执行该迁移文件；不要直接在生产项目验证。先用开发项目检查匿名用户和邮箱账号的读写隔离。

本迁移只定义数据结构和权限，不会自动导入或同步浏览器里的现有数据。客户端后续应以行级 `revision` 做乐观并发控制：新增记录可自动合并；更新时带上读到的旧版本，若没有更新到任何行，就拉取最新值并提示冲突。执行迁移前，应在 Supabase 的开发项目验证 RLS，确认匿名账号只能访问自己的数据。
