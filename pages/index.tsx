import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import UnitTest from './unitTest';
import DesignPatterns from './designPatterns';

const Home: NextPage = () => {
  return (
    <div>
      <Head>
        <title>next-demo</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="w-1/2 m-[100px] mx-auto">
        <ul>
          <li><Link href="/file"><a>大文件上传，下载</a></Link></li>
          <li><Link href="/promise"><a>promise</a></Link></li>
          <li><Link href="/unitTest"><a>UnitTest</a></Link></li>
          <li><Link href="/echarts"><a>echarts</a></Link></li>
          <li><Link href="/designPatterns"><a>DesignPatterns</a></Link></li>
        </ul>
      </main>
    </div>
  );
};

export default Home;
