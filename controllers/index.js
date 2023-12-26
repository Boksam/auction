const { Op } = require('sequelize');
const { Good, Auction, User, sequelize } = require('../models');
const schedule = require('node-schedule');

exports.renderMain = async (req, res, next) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1); // 어제 시간
    const goods = await Good.findAll({ 
      where: { SoldId: null, createdAt: { [Op.gte]: yesterday } },
    });

    goods.forEach((good) => {
      const halfDayLater = new Date(good.createdAt);
      halfDayLater.setHours(halfDayLater.getHours() + 12);

      const job = scheduleJob(halfDayLater, async () => {
        if (!good.Auctions.length) {
          const halfPrice = Math.floor(good.price * 0.5);
          await Good.update({ price: halfPrice }, { where: { id: good.id } });
        }
      });

      job.on('error', (err) => {
        console.error('스케줄링 에러', err);
      });

      job.on('canceled', () => {
        console.log('스케줄이 취소되었습니다.');
      });
    });
    
    res.render('main', {
      title: 'NodeAuction',
      goods,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

exports.renderJoin = (req, res) => {
  res.render('join', {
    title: '회원가입 - NodeAuction',
  });
};

exports.renderGood = (req, res) => {
  res.render('good', { title: '상품 등록 - NodeAuction' });
};

exports.createGood = async (req, res, next) => {
  try {
    const { name, price } = req.body;
    const good = await Good.create({
      OwnerId: req.user.id,
      name,
      img: req.file.filename,
      price,
    });
    const end = new Date();
    end.setDate(end.getDate() + 1); // 하루 뒤
    const job = schedule.scheduleJob(end, async () => {
      const success = await Auction.findOne({
        where: { GoodId: good.id },
        order: [['bid', 'DESC']],
      });
      await good.setSold(success.UserId);
      await User.update({
        money: sequelize.literal(`money - ${success.bid}`),
      }, {
        where: { id: success.UserId },
      });
    });
    job.on('error', (err) => {
      console.error('스케줄링 에러', err);
    });
    job.on('success', () => {
      console.log('스케줄링 성공');
    });
    res.redirect('/');
  } catch (error) {
    console.error(error);
    next(error);
  }
};

exports.renderAuction = async (req, res, next) => {
  try {
    const [good, auction] = await Promise.all([
      Good.findOne({
        where: { id: req.params.id },
        include: {
          model: User,
          as: 'Owner',
        },
      }),
      Auction.findAll({
        where: { GoodId: req.params.id },
        include: { model: User },
        order: [['bid', 'ASC']],
      }),
    ]);
    res.render('auction', {
      title: `${good.name} - NodeAuction`,
      good,
      auction,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

exports.bid = async (req, res, next) => {
  try {
    const { bid, msg } = req.body;
    const good = await Good.findOne({
      where: { id: req.params.id },
      include: { model: Auction },
      order: [[{ model: Auction }, 'bid', 'DESC']],
    });

    if (!good) {
      return res.status(404).send('해당 상품은 존재하지 않습니다.');
    }

    const user = await User.findOne({ where: { id: req.user.id } });
    if (user.money < bid) {
      return res.status(403).json({ error: '입찰 금액이 보유 자산보다 큽니다.' });
    }

    if (good.price >= bid) {
      return res.status(403).json({ error: '시작 가격보다 높게 입찰해야 합니다.' });
    }

    if (new Date(good.createdAt).valueOf() + (24 * 60 * 60 * 1000) < new Date()) {
      return res.status(403).json({ error: '경매가 이미 종료되었습니다.' });
    }

    if (good.Auctions[0]?.bid >= bid) {
      return res.status(403).json({ error: '이전 입찰가보다 높아야 합니다.' });
    }

    // 이전 입찰자와 현재 입찰자가 동일한 경우 에러 응답
    if (good.Auctions[0]?.UserId === req.user.id) {
      return res.status(403).json({ error: '두 번 연속으로 입찰할 수 없습니다.' });
    }

    await User.update({
      money: sequelize.literal(`money - ${bid}`),
    }, {
      where: { id: req.user.id },
    });

    const result = await Auction.create({
      bid,
      msg,
      UserId: req.user.id,
      GoodId: req.params.id,
    });

    req.app.get('io').to(req.params.id).emit('bid', {
      bid: result.bid,
      msg: result.msg,
      nick: req.user.nick,
    });

    return res.send('ok');
  } catch (error) {
    console.error(error);
    return next(error);
  }
};

exports.renderList = async (req, res, next) => {
  try {
    const goods = await Good.findAll({
      where: { SoldId: req.user.id },
      include: { model: Auction },
      order: [[{ model: Auction }, 'bid', 'DESC']],
    });
    res.render('list', { title: '낙찰 목록 - NodeAuction', goods });
  } catch (error) {
    console.error(error);
    next(error);
  }
};