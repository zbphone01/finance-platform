const bankArrivalSteps = [
  {
    title: "第一步，确认“认账信息设置”中是否有项目信息。",
    paragraphs: [
      "确认“预算编码”是否存在，如不存在联系管理员沟通添加。",
      "如果是互联网募捐平台的捐赠收入，确认“公益平台”中是否有平台项目和项目详情。",
    ],
  },
  {
    title: "第二步，记录到账信息。",
    paragraphs: [
      "进入“到账信息汇总”菜单，进入“未记录”列表（该列表自动记录所有未登记特征的银行到账），找到符合特征的任意一条到账信息，点击“记录”按钮。",
      "记录到账信息时，匹配条件中“用途”、“附言”和“摘要”为选填和模糊匹配，也可以根据情况增加多个匹配条件。",
      "凭证收入渠道和渠道认账地区根据实际情况选择，认账类型选择“到账认账”。",
    ],
  },
  {
    title: "第三步，添加到账认账规则。",
    paragraphs: [
      "进入“认账规则 - 到账认账”菜单，点击新建规则。匹配到账信息，选择刚刚记录的到账信息别称，然后设置认账规则。",
      "设置生效后新上传的银行流水便会自动执行到账认账。已上传的银行流水，点击日期任务的开始认账，未认账的银行流水也会重新进行规则匹配并认账。",
    ],
  },
];

const orderDetailSteps = [
  {
    title: "第一步，确认“认账信息设置”中是否有项目信息。",
    paragraphs: [],
  },
  {
    title: "第二步，记录到账信息。",
    paragraphs: [
      "认账类型选择“明细认账”。",
      "明细匹配到账方式和明细包类型根据实际情况选择。",
    ],
  },
  {
    title: "第三步，新建明细认账规则。",
    paragraphs: [],
  },
  {
    title: "第四步，上传订单明细。",
    paragraphs: [
      "进入“认账及分账”菜单，点击“上传订单明细”，选择订单明细文件和对应的明细认账规则，上传文件后如果系统有对应的银行到账，认账将自动开始。",
      "订单明细在开始上传和入库完成后会两次查找匹配的银行到账，如果匹配失败认账不会执行，后续上传银行到账后，需要点击“开始认账”手动开始。",
    ],
  },
];

const detailSplitSteps = [
  {
    title: "第一步，确认明细分账条件",
    paragraphs: [
      "确认订单明细文件中，用哪列（列标题为明细分账判断字段）的哪个关键词来判断该行的明细需要明细分账，哪列（列标题为明细匹配字段）用来匹配明细分账条目。",
      "确认明细分账文件中，用哪列（列标题为认账条件字段）进行认账，哪列是收入，哪列用来匹配明细分账条目。",
    ],
  },
  {
    title: "第二步，编辑明细认账规则",
    paragraphs: [
      "编辑具体的明细认账规则，打开“明细分账”开关，填写以上确认的信息。",
    ],
  },
  {
    title: "第三步，上传及认账",
    paragraphs: [
      "进入“明细分账”菜单，选择上传明细分账文件及认账规则，文件上传完毕后会自动进行全量明细分账认账。",
      "如果明细分账文件在分账认账后还有待认账的分账信息，后续上传新的订单明细，点击“操作”栏的开始拆分认账按钮，可以手动开始拆分认账。",
    ],
  },
];

const tPlusOneExceptionSteps = [
  {
    title: "（1）如果订单明细总额 > 银行到账",
    paragraphs: [
      "认账会直接终止，日期状态提示“差异大”，日期汇总的银行流水列表状态提示红色的“未认账”，差额金额列用红色显示超过银行到账的金额，点击后系统推荐可忽略订单，确认忽略订单后重启认账。",
    ],
  },
  {
    title: "（2）如果订单明细 < 银行到账",
    paragraphs: [
      "认账会正常进行，日期汇总的银行流水列表状态提示“部分认账”，差额金额列用蓝色显示银行到账的未认账金额，点击后系统推荐转移和忽略订单（组合匹配待拆分订单以外的未认账金额），确认后执行增量认账。",
      "如果未认账金额全部为待拆分订单，系统将不进行推荐并提示。",
    ],
  },
];

const packagedOrderExceptionSteps = [
  {
    title: "（1）单笔匹配",
    paragraphs: [
      "因为收入提现和订单明细导出都是人工定期操作，正常情况不会出现银行到账和订单明细不匹配导致的无法认账。",
      "打包明细上传后会自动寻找最早日期的已匹配的未认账银行流水，不匹配通常是由于漏传或错传了订单明细包。漏传可通过上传订单明细时手动选择到账日期解决，错传删除订单明细包后重传正确订单明细包即可自动认账。",
    ],
  },
  {
    title: "（2）多日汇总匹配",
    paragraphs: [
      "不能认账是由于订单明细金额>匹配的银行到账和，添加更多银行到账会自动执行认账，入账日期会记录为最新的到账日期。",
      "打包明细的银行流水不存在“部分认账”的可能性。",
    ],
  },
];

function GuideSection({
  title,
  intro,
  outro,
  steps,
  withDivider = false,
}: {
  title: string;
  intro?: string;
  outro?: string;
  steps: Array<{ title: string; paragraphs: string[] }>;
  withDivider?: boolean;
}) {
  return (
    <section className={`space-y-5 ${withDivider ? "border-t border-gray-200 pt-5" : ""}`}>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {intro && <p className="text-sm leading-7 text-gray-700">{intro}</p>}
      </div>
      <div className="space-y-4">
        {steps.map((step) => (
          <div key={step.title} className="space-y-2 border-l-2 border-blue-100 pl-4">
            <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
            {step.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-7 text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>
      {outro && <p className="text-sm leading-7 text-gray-700">{outro}</p>}
    </section>
  );
}

export default function OperationGuidePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">操作指引</h1>
      </div>

      <GuideSection
        title="1、银行到账设置自动认账"
        intro="银行流水信息如果存在明确的用途或附言，如淘天平台到账，可设置到账认账规则，每次银行流水上传至系统后可自动完成认账。"
        outro="针对一些明确用途的银行流水，但无法通过比例自动分账的情况，在新建到账认账规则时，分账形式可选择“认账时填写”，这类银行到账在上传后会显示“待认账”状态，点击后只需要填写分账金额进行认账。"
        steps={bankArrivalSteps}
      />

      <GuideSection title="2、订单明细认账" steps={orderDetailSteps} withDivider />
      <GuideSection title="3、明细分账" steps={detailSplitSteps} withDivider />
      <GuideSection title="4、T+1订单明细认账的异常情况" steps={tPlusOneExceptionSteps} withDivider />
      <GuideSection title="5、打包订单明细认账的异常情况" steps={packagedOrderExceptionSteps} withDivider />
    </div>
  );
}
