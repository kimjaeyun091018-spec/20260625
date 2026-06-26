const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');

const app = express();
const port = 3000;

// 데이터베이스 연결 설정
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '1111',
  database: 'uber',
};

// 미들웨어 설정
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));

// 데이터베이스 연결 함수
async function getConnection() {
  return await mysql.createConnection(dbConfig);
}

// 라우트 설정
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/postlogin', (req, res) => {
  res.render('postlogin');
});

app.get('/helthcheck', (req, res) => {
  res.send("I'm alive !!!!!!!!!!!!");
});

// app.get('/main', async (req, res) => {
//   if (!req.session.userid) {
//     return res.redirect('/login');
//   }

//   const conn = await getConnection();

//   try {
//     const [rows] = await conn.execute('SELECT * FROM users');
//     res.render('main', { users: rows });
//   } catch (error) {
//     console.error('사용자 목록 조회 오류:', error);
//     res.status(500).send('서버 오류');
//   } finally {
//     conn.end();
//   }
// });

app.get('/main', async (req, res) => {
  if (!req.session.userid) {
    return res.redirect('/login');
  }

  const conn = await getConnection();

  try {
    // 먼저 현재 로그인한 사용자의 성별을 가져옵니다.
    const [userRows] = await conn.execute('SELECT gender FROM users WHERE id = ?', [req.session.userid]);
    
    if (userRows.length === 0) {
      return res.status(404).send('사용자를 찾을 수 없습니다.');
    }

    const userGender = userRows[0].gender;
    
    // 사용자의 성별에 따라 반대 성별의 사용자만 가져옵니다.
    const oppositeGender = userGender === '남성' ? '여성' : '남성';
    
    const [rows] = await conn.execute('SELECT * FROM users WHERE gender = ?', [oppositeGender]);
    res.render('main', { users: rows });
  } catch (error) {
    console.error('사용자 목록 조회 오류:', error);
    res.status(500).send('서버 오류');
  } finally {
    conn.end();
  }
});

app.post('/login', async (req, res) => {
  const { id, pw } = req.body;
  const conn = await getConnection();

  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [id]);

    if (rows.length > 0) {
      const user = rows[0];
      const match = await bcrypt.compare(pw, user.pw);

      if (match) {
        req.session.userid = user.id;
        res.redirect('/postlogin');
      } else {
        res.send('로그인 실패: 비밀번호가 일치하지 않습니다.');
      }
    } else {
      res.send('로그인 실패: 사용자를 찾을 수 없습니다.');
    }
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).send('서버 오류');
  } finally {
    conn.end();
  }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('세션 삭제 중 오류 발생:', err);
      }
      res.redirect('/login');
    });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { id, pw, name, age, sch_name, gender, instagram } = req.body;
  const conn = await getConnection();

  try {
    const hashedPassword = await bcrypt.hash(pw, 10);
    await conn.execute(
      'INSERT INTO users (id, pw, name, age, sch_name, gender, instagram) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, hashedPassword, name, age, sch_name, gender, instagram]
    );

    req.session.userid = id;
    res.redirect('/postlogin');
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).send('서버 오류');
  } finally {
    conn.end();
  }
});

app.get('/userinfo', async (req, res) => {
  if (!req.session.userid) {
    return res.redirect('/login');
  }

  const conn = await getConnection();

  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [req.session.userid]);
    if (rows.length > 0) {
      const user = rows[0];
      return res.render('userinfo', { user });
    } else {
      res.status(404).send('사용자를 찾을 수 없습니다.');
    }
  } catch (error) {
    console.error('사용자 정보 조회 오류:', error);
    res.status(500).send('서버 오류');
  } finally {
    conn.end();
  }
});


app.get('/admin', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const conn = await getConnection();
  
    try {
      const [rows] = await conn.execute('SELECT * FROM users');
      res.render('admin', { users: rows });
    } catch (error) {
      console.error('사용자 목록 조회 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });
  
  app.get('/user/:id', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const conn = await getConnection();
  
    try {
      const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
      if (rows.length > 0) {
        res.render('edit-user', { user: rows[0] });
      } else {
        res.status(404).send('사용자를 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('사용자 정보 조회 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });
  
  app.get('/user/:id', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const conn = await getConnection();
  
    try {
      const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
      if (rows.length > 0) {
        res.render('edit-user', { user: rows[0] });
      } else {
        res.status(404).send('사용자를 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('사용자 정보 조회 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });
  
  // 사용자 정보 수정 처리
  app.post('/user/:id', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const { name, age, sch_name, gender, instagram } = req.body;
    const conn = await getConnection();
  
    try {
      await conn.execute(
        'UPDATE users SET name = ?, age = ?, sch_name = ?, gender = ?, instagram = ? WHERE id = ?',
        [name, age, sch_name, gender, instagram, req.params.id]
      );
      res.redirect('/admin');
    } catch (error) {
      console.error('사용자 정보 수정 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });
  
  // 고백 정보 초기화
  app.post('/user/:id/reset-asker', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const conn = await getConnection();
  
    try {
      await conn.execute('UPDATE users SET asker = NULL WHERE id = ?', [req.params.id]);
      res.redirect('/admin');
    } catch (error) {
      console.error('고백 정보 초기화 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });
  
  app.post('/user/:id/delete', async (req, res) => {
    if (!req.session.userid) {
      return res.redirect('/login');
    }
  
    const conn = await getConnection();
  
    try {
      await conn.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
      res.redirect('/admin');
    } catch (error) {
      console.error('사용자 삭제 오류:', error);
      res.status(500).send('서버 오류');
    } finally {
      conn.end();
    }
  });

// 고백 처리 라우트
app.post('/user/:id/update', async (req, res) => {
  console.log('고백 요청 받음:', req.params.id);
  if (!req.session.userid) {
    console.log('로그인되지 않은 사용자');
    return res.redirect('/login');
  }

  const conn = await getConnection();

  try {
    // 트랜잭션 시작
    await conn.beginTransaction();

    // 고백을 하는 사용자 (현재 로그인한 사용자) 정보 조회
    const [confessorRows] = await conn.execute('SELECT asker FROM users WHERE id = ?', [req.session.userid]);
    
    if (confessorRows.length === 0) {
      await conn.rollback();
      return res.status(404).send('고백하는 사용자를 찾을 수 없습니다.');
    }

    // 고백하는 사용자가 이미 고백한 경우
    if (confessorRows[0].asker !== null) {
      await conn.rollback();
      return res.send('<script>alert("이미 다른 사용자에게 고백하셨습니다."); window.location.href="/main";</script>');
    }

    // 고백을 받는 사용자 정보 조회
    const [receiverRows] = await conn.execute('SELECT asker FROM users WHERE id = ?', [req.params.id]);
    
    if (receiverRows.length === 0) {
      await conn.rollback();
      return res.status(404).send('고백 대상 사용자를 찾을 수 없습니다.');
    }

    // 고백 대상이 이미 고백을 받은 경우
    if (receiverRows[0].asker !== null) {
      await conn.rollback();
      return res.send('<script>alert("이미 고백을 받은 사용자입니다."); window.location.href="/main";</script>');
    }

    // 고백하는 사용자의 asker 필드 업데이트
    await conn.execute('UPDATE users SET asker = ? WHERE id = ?', [req.params.id, req.session.userid]);

    // 고백 받는 사용자의 asker 필드 업데이트
    await conn.execute('UPDATE users SET asker = ? WHERE id = ?', [req.session.userid, req.params.id]);

    // 트랜잭션 커밋
    await conn.commit();

    res.send('<script>alert("고백이 성공적으로 전달되었습니다."); window.location.href="/main";</script>');
  } catch (error) {
    await conn.rollback();
    console.error('고백 처리 오류:', error);
    res.status(500).send('서버 오류');
  } finally {
    conn.end();
  }
});

app.listen(port, () => {
  console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});


/*

1) 향후 과제
DB Part
- DB 정규화
- 인덱스(클러스터 인덱스 / 비클러스터 인덱스)
- Join (inner join, left join)
- Transaction(commit) : CUD 의 경우 DB Transaction 을 이용해야함.
- 테이블 및 컬럼에는 Comment(주석)에 한글로 논리적 컬럼명 및 설명 필요
- 사용자테이블에 wdate(작성일:datetime), udate(수정일:datetime) 추가 필요


UI Part
- 디버깅
- admin 화면은 admin 권한이 있는 사람만 버튼이 보여지고 또한 /admin 을 호출했을 admin 권한이 있는지도 체크 필요
  (테이블에서 admin 컬럼을 하나 만들어서 Y/N 으로 관리)
- app.js 에서 모든 라우팅을 처리하므로 기능 추가시 마다 app.js 의 소스가 계속 늘어남.
  따라서 express의 router 를 사용하여 기능 모듈별로 나누어서 별도 파일로 관리 필요함.
  예) user.js 파일을 별도로 만들어서 로그인/로그아웃/회원가입 기능은 여기서 처리

Source Part
- 소스 관리 git



2) 프롬프트 전문.

nodejs, express, mysql 을 사용해서 users 테이블에 대한 crud 예제를 만들어줘.

데이타베이스 정보는 스키마는 uber이고 기본포트를 사용하고
계정은 root, 비밀번호는 1111 이다.
uses 테이블 스크립트는 아래와 같다.

CREATE TABLE `users` (
  `id` varchar(20) NOT NULL COMMENT '아이디',
  `pw` varchar(100) DEFAULT NULL,
  `name` varchar(45) DEFAULT NULL,
  `sch_name` varchar(45) DEFAULT NULL,
  `sch_class` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_UNIQUE` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='회원테이블'


그리고 view engine은 ejs를 사용하고 session을 사용해서 로그인 여부를 체크한다.
이때 session에는 userid 라는 키에 사용자id를 넣을 것이다.

1) localhost:3000/ 으로 접근하면
로그인할수있는 localhost:3000/login 으로 이동하고 회원가입 링크도 하나만든다. 회원가입 링크는 register 이다.

2) 로그인이 성공하면 세션에 정보를 넣고 userinfo 라는 경로로 이동해서 회원가입시 정보를 보여준다.
이때 비밀번호는 bcrypt를 이용해서 비교한다.

3) 회원가입은 테이블 명세에 있는 모든 값들을 입력받는다.
비밀번호는 bcrypt 암호화를 한다.

4) 회원가입이후에도 세션에 정보를 넣고 userinfo 라는 경로로 이동해서 회원가입시 정보를 보여준다.

5) /logout 호출시에는 세션을 제거하고 /login 으로 이동

6) /admin 으로 접근하면 화면에 사용자 리스트화면을 만들고 users 테이블의 모든 사용자정보를 리스트로 보여주고
 보여주는 컬럼은 아이디, 이름, 학교, 학년, 삭제버튼, 수정 이렇게 해주고
 삭제버튼시에는 /user/아이디 형태로 호출하면 delete를 할수있게 해주고 안전하게 삭제하기 위해 post 방식으로 하고
 삭제버튼 클릭시 "삭제하시겠습니까?" 라는 확인메세지도 나오게 해줘.
 삭제후 다시 리스트화면으로 이동한다.
 수정을 클릭했을때는 /user/아이디 형태로 호출하고 수정화면으로 이동해서 각 정보를 수정하고 확인버튼을 누르면
 다시 사용자정보 리스트로 오게 해줘.
 
 

7) 각 화면들은 이쁘게 만들어줘.

8) express의 router를 사용하지 않고 구성해줘.

9) 소스를 보여줄때 각 파일별로 보여줘.

10) 소스에 대한 설명도 자세히 알려줘.

11) 프로그램을 실행하는 방법을 알려줘.

12) 개발시에 소스를 수정하더라도 재시작하지 않아도 바로 확인할 수 있도록 설정하고 실행방법 알려줘.


13) vscode에서 이 소스를 디버깅하는 방법 알려줘.

14) DB 정규화에 대해 알려주고 몇가지 예제를 보여줘.

15) 인덱스에 대해 설명하고 예제도 알려줘.

16) 조인 방법 알려주고 예제도 알려줘.

17) DB 트랜잭션에 대해 알려주고 이 소스의 경우 어디에 적용할지 알려줘.

*/
