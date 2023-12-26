const { scheduleJob } = require('node-schedule');
const { Op } = require('sequelize');
const { Good, Auction, User, sequelize } = require('./models');

module.exports = async () => {
  console.log('checkAuction');
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1); // 어제 시간
    const targets = await Good.findAll({
      where: {
        SoldId: null,
        createdAt: { [Op.lte]: yesterday },
      },
    });

    targets.forEach(async (good) => {
      const end = new Date(good.createdAt);
      end.setDate(end.getDate() + 1); // 생성일 24시간 뒤가 낙찰 시간

      const job = scheduleJob(end, async () => {
        const success = await Auction.findOne({
          where: { GoodId: good.id },
          order: [['bid', 'DESC']],
        });

        if (!success) {
          // 입찰이 없는 경우 상품을 등록한 사람에게 낙찰
          await good.setSold(good.OwnerId);
          await User.update({
            money: sequelize.literal(`money - ${good.price}`),
          }, {
            where: { id: good.OwnerId },
          });
        }
        job.on('error', (err) => {
          console.error('스케줄링 에러', err);
        });
  
        job.on('canceled', () => {
          console.log('스케줄이 취소되었습니다.');
        });
      });

      
    });
  } catch (error) {
    console.error(error);
  }
};