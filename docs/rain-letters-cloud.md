# 雨水一盒：云端信件队列

## 数据集合

在云开发控制台建立集合 `rainLetters`。云函数会写入发送者、接收者、日期、
信件正文、歌曲卡片和投递状态；返回给客户端的数据不会包含双方的 OpenID。
信件仅要求正文非空，标题、落款、歌曲和歌词均为可选内容。没有填写落款时，
服务端会统一保存并展示为“神秘人”。

新用户第一次收信固定收到 `seed-rain-box-welcome` 欢迎信模板生成的《雨水一盒》；
该模板不会被普通随机投递消耗。欢迎信会为每位新用户生成独立的已投递记录并进入
收件箱，第二次起才从 `pending` 队列随机领取。

## 投递策略

领取顺序如下：

1. 正式版当天已经领过信时返回当天原信；
2. 从未收过信的新用户固定生成《雨水一盒》欢迎信；
3. 从 `pending` 公共池随机寻找用户信，并通过 `status: pending` 条件更新原子抢占；
4. 公共池为空或并发抢占失败时，从 `templateKind: reserve` 的系统模板中生成独立副本；
5. 系统模板优先选择用户未读过的模板，全部读过后才允许循环。

随机领取不会先把整个公共池读进内存。服务端生成随机游标，在 `randomKey` 索引上从随机
位置向后取一小段候选，末尾不足时从索引开头环回；候选顺序再次打散。单次最多读取
20 条，最多重试 3 轮，适合公共池扩大后的稳定查询。最终条件更新确保同一封用户信不会
被两个并发请求同时领取。

系统模板可以重复生成投递副本，普通用户信仍然只投递给一个人，不会在池空时被重新广播。
保底模板保存在云端，不放入小程序发布包；公共池为空时允许循环生成投递副本。

## 文字内容审核

用户寄信时，云函数先将标题、正文、落款和歌曲信息交给微信
`security.msgSecCheck`（版本 2、论坛场景）审核。只有 `suggest: pass` 才写入
`rainLetters`；`review`、`risky` 或审核接口异常都不会落库。审核未通过时客户端显示
“暂时不能发送”弹窗并让用户返回修改。

云函数的 `config.json` 必须声明：

```json
{
  "permissions": {
    "openapi": ["security.msgSecCheck"]
  }
}
```

集合权限建议设为“所有用户不可读写”，所有信件只允许云函数代为访问。

建议建立以下组合索引：

- `senderOpenId`（升序）+ `senderDay`（升序）
- `recipientOpenId`（升序）+ `recipientDay`（升序）+ `deliveredAtMs`（升序）
- `status`（升序）+ `randomKey`（升序）
- `senderOpenId`（升序）+ `createdAtMs`（降序）
- `recipientOpenId`（升序）+ `deliveredAtMs`（降序）

## 部署

在微信开发者工具中右键 `cloudfunctions/rainLetters`，选择“上传并部署：云端安装依赖”。

部署目标环境必须是 `cloud1-d7g2ztvs63d2800d4`。部署完成后，在云函数列表确认
`rainLetters` 存在，再恢复客户端的发送、接收和信箱同步调用。

可在微信开发者工具的 Console 中执行以下无写入测试：

```js
wx.cloud.callFunction({
  name: "rainLetters",
  data: { action: "list" }
}).then(console.log).catch(console.error)
```

成功结果应包含 `result.ok: true`，以及空数组或已有内容的 `inbox`、`outbox`。

云端默认对开发版、体验版和正式版统一执行限制：每个 OpenID 每天只能发送、领取一封，
且不会领取自己写的信。客户端传入的版本号不能自行解除限制。只有云函数管理员显式设置
`RAIN_LETTERS_ALLOW_PREVIEW_BYPASS=true` 时才会临时开放联调豁免；正式环境必须保持
`false`。
