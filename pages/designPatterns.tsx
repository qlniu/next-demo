import React, { useEffect } from "react";
import SingletonInstance from "@/lib/designPatterns/singletonPattern";
import ObserverPattern from "@/lib/designPatterns/observerPattern";
import DecoratorPattern from "@/lib/designPatterns/decoratorPattern";
import FactoryPattern from '@/lib/designPatterns/factoryPattern';

type Props = {};

const DesignPatterns: React.FunctionComponent<Props> = () => {
  useEffect(() => {}, []);
  return (
    <ul className="w-1/2 m-[100px] mx-auto">
      <li className="border-b border-slate-200 py-[12px]">
        <ObserverPattern />
      </li>
      <li className="border-b border-slate-200 py-[12px]">
        <SingletonInstance />
      </li>
      <li className="border-b border-slate-200 py-[12px]">
        <DecoratorPattern />
      </li>
      <li className="border-b border-slate-200 py-[12px]">
        <FactoryPattern />
      </li>
    </ul>
  );
};
export default DesignPatterns;
