from glob import glob

from setuptools import find_packages, setup

package_name = 'agv_main'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', glob('launch/*.launch.py')),
        ('share/' + package_name + '/config', glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='VE-com team',
    maintainer_email='user@todo.todo',
    description='AGV Main Control Package',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            # デモ（決まった動きをするだけ）
            'auto_drive = agv_main.auto_drive:main',
            # PC1: Web(MQTT) ⇔ ROS
            'mqtt_bridge = agv_main.mqtt_bridge:main',
            # ラズパイ: /cmd_vel ⇔ ESP32、安全ガード、/odom
            'serial_bridge = agv_main.serial_bridge:main',
            # ラズパイ: センサー
            'lidar_node = agv_main.lidar_node:main',
            'camera_node = agv_main.camera_node:main',
            # シミュレーターの車（実機の代わり）
            'sim_robot = agv_main.sim_robot:main',
            # 調整用の道具
            'scan_check = agv_main.scan_check:main',
            'esp32_console = agv_main.esp32_console:main',
        ],
    },
)
